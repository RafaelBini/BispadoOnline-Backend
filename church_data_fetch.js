const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv-safe').config({
    allowEmptyValues: true,
});

const SESSION_DIR = path.join(__dirname, '.church-session');
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const LOOKUP_CONCURRENCY = 6;

var puppeteerConfig = {
    headless: true,
    protocolTimeout: 3600000,
    args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-setuid-sandbox',
    ]
}
if (process.env.NODE_ENV == 'PROD') {
    puppeteerConfig.executablePath = '/snap/bin/chromium'
    puppeteerConfig.args.push('--single-process', '--no-zygote')
} else if (process.platform === 'win32') {
    puppeteerConfig.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
}

const DEFAULT_TIMEOUT = 120000;
const LOOKUP_READY_TIMEOUT = 180000;
const MEMBER_LIST_RSC_TIMEOUT = 180000;

const LCR_ORIGIN = 'https://lcr.churchofjesuschrist.org';
const MEMBER_LOOKUP_BASE = 'https://mltp-api.churchofjesuschrist.org/api/member-lookup?term=';
const MLT_APP_URL = `${LCR_ORIGIN}/mlt/`;
const MEMBER_LIST_URL = `${LCR_ORIGIN}/mlt/records/member-list?lang=eng`;

const memorySessionCache = new Map();

function sessionKey(churchUser) {
    return crypto.createHash('sha256').update(churchUser).digest('hex');
}

function sessionFilePath(churchUser) {
    return path.join(SESSION_DIR, `${sessionKey(churchUser)}.json`);
}

function loadStoredSession(churchUser) {
    const cached = memorySessionCache.get(sessionKey(churchUser));
    if (cached && Date.now() - cached.savedAt < SESSION_MAX_AGE_MS) {
        return cached.cookies;
    }

    const filePath = sessionFilePath(churchUser);
    if (!fs.existsSync(filePath)) return null;

    try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!payload.cookies?.length || Date.now() - payload.savedAt > SESSION_MAX_AGE_MS) {
            return null;
        }
        memorySessionCache.set(sessionKey(churchUser), payload);
        return payload.cookies;
    } catch {
        return null;
    }
}

function clearStoredSession(churchUser) {
    memorySessionCache.delete(sessionKey(churchUser));
    const filePath = sessionFilePath(churchUser);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function clearBrowserCookies(page) {
    const cookies = await page.cookies();
    if (cookies.length) {
        await page.deleteCookie(...cookies);
    }
}

async function persistSession(churchUser, cookies) {
    const payload = { savedAt: Date.now(), cookies };
    memorySessionCache.set(sessionKey(churchUser), payload);
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(sessionFilePath(churchUser), JSON.stringify(payload));
}

async function enableLeanPage(page) {
    if (page._leanInterceptionEnabled) return;
    page._leanInterceptionEnabled = true;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'media', 'font'].includes(type)) {
            req.abort();
            return;
        }
        req.continue();
    });
}

async function applyCookies(page, cookies) {
    if (!cookies?.length) return;
    await page.goto(LCR_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    await page.setCookie(...cookies);
}

async function waitUntilMemberLookupReady(page) {
    await page.waitForFunction(async (memberLookupBase) => {
        try {
            const response = await fetch(`${memberLookupBase}a`, { credentials: 'include' });
            if (!response.ok) return false;
            const data = await response.json();
            return Array.isArray(data?.memberResults);
        } catch {
            return false;
        }
    }, { timeout: LOOKUP_READY_TIMEOUT, polling: 500 }, MEMBER_LOOKUP_BASE);
}

async function sessionCanFetchMembers(page) {
    try {
        await waitUntilMemberLookupReady(page);
        return true;
    } catch {
        return false;
    }
}

async function openMltContext(page) {
    await page.goto(MLT_APP_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
}

async function fillInput(page, selector, value) {
    await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT });
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 0 });
}

async function performLogin(page, user, pass) {
    await page.goto(LCR_ORIGIN, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    await fillInput(page, 'input[name="username"]', user);

    await page.waitForSelector('button[id="button-primary"]', { timeout: DEFAULT_TIMEOUT });
    await page.click('button[id="button-primary"]');

    await fillInput(page, 'input[type="password"]', pass);

    await page.waitForSelector('button[id="button-primary"]', { timeout: DEFAULT_TIMEOUT });
    await page.click('button[id="button-primary"]');

    await page.waitForSelector('input[type=search]', { timeout: DEFAULT_TIMEOUT });

    await openMltContext(page);
    await waitUntilMemberLookupReady(page);
}

function parseMemberListRscPayload(rscText) {
    const match = rscText.match(/:\{"members":\[/);
    if (!match || match.index === undefined) return new Map();

    const start = match.index + 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < rscText.length; i++) {
        const ch = rscText[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }

    let members;
    try {
        members = JSON.parse(rscText.slice(start, end)).members;
    } catch {
        return new Map();
    }
    if (!Array.isArray(members)) return new Map();

    const byId = new Map();
    for (const person of members) {
        const id = person.uuid ?? person.id;
        if (!id) continue;
        byId.set(String(id), {
            birth: person.birthDateSort ?? person.birthDateDisplay ?? '',
            email: person.email ?? '',
            phoneNumber: person.phone ?? '',
            priesthoodOffice: person.priesthoodOffice ?? '',
        });
    }
    return byId;
}

function waitForMemberListRscPayload(page, timeoutMs = MEMBER_LIST_RSC_TIMEOUT) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            page.off('response', onResponse);
            resolve(null);
        }, timeoutMs);

        async function onResponse(response) {
            const url = response.url();
            if (!url.includes('/mlt/records/member-list')) return;
            const contentType = response.headers()['content-type'] || '';
            if (!contentType.includes('component')) return;
            try {
                const text = await response.text();
                if (text.length < 100000 || !text.includes('"members":[')) return;
                clearTimeout(timer);
                page.off('response', onResponse);
                resolve(text);
            } catch {
                /* response body unavailable */
            }
        }

        page.on('response', onResponse);
    });
}

async function scrapeMemberListDomEnrichment(page) {
    return page.evaluate(() => {
        const byId = {};
        for (const row of document.querySelectorAll('tr')) {
            const nameCell = row.querySelector('[data-member-card-person-uuid]');
            if (!nameCell) continue;
            const id = nameCell.getAttribute('data-member-card-person-uuid');
            if (!id) continue;

            let birth = '';
            let phoneNumber = '';
            let email = '';
            for (const cell of row.querySelectorAll('td')) {
                const text = cell.textContent?.trim() || '';
                if (text.startsWith('Birth Date')) birth = text.slice('Birth Date'.length).trim();
                if (text.startsWith('Phone Number')) phoneNumber = text.slice('Phone Number'.length).trim();
                if (text.startsWith('E-mail')) email = text.slice('E-mail'.length).trim();
            }
            const mailLink = row.querySelector('a[href^="mailto:"]');
            const telLink = row.querySelector('a[href^="tel:"]');
            if (mailLink?.textContent?.trim()) email = mailLink.textContent.trim();
            if (telLink?.textContent?.trim()) phoneNumber = telLink.textContent.trim();

            byId[id] = { birth, email, phoneNumber, priesthoodOffice: '' };
        }
        return byId;
    });
}

function mergeMemberListEnrichment(members, enrichmentById) {
    for (const member of members) {
        const extra = enrichmentById.get(member.id);
        if (!extra) continue;
        if (!member.birth && extra.birth) member.birth = extra.birth;
        if (!member.email && extra.email) member.email = extra.email;
        if (!member.phoneNumber && extra.phoneNumber) member.phoneNumber = extra.phoneNumber;
        if (!member.priesthoodOffice && extra.priesthoodOffice) {
            member.priesthoodOffice = extra.priesthoodOffice;
        }
    }
    return members;
}

async function fetchMemberListEnrichment(page) {
    const payloadPromise = waitForMemberListRscPayload(page);
    await page.goto(MEMBER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    const rscText = await payloadPromise;
    let enrichment = rscText ? parseMemberListRscPayload(rscText) : new Map();
    if (enrichment.size === 0) {
        try {
            await page.waitForFunction(
                () => document.body?.innerText?.includes('Birth Date'),
                { timeout: DEFAULT_TIMEOUT }
            );
            enrichment = new Map(Object.entries(await scrapeMemberListDomEnrichment(page)));
        } catch {
            console.warn('Member list DOM enrichment unavailable (timeout or layout change)');
        }
    }
    return enrichment;
}

async function fetchAllMembers(page) {
    return page.evaluate(async (memberLookupBase, concurrency) => {
        function asEmpty(value) {
            if (value === null || value === undefined) return '';
            return value;
        }

        function formatName(person) {
            const listPreferred =
                person.nameFormats?.listPreferredLocal ||
                person.nameListPreferredLocal;
            if (listPreferred) {
                const parts = String(listPreferred).split(', ');
                if (parts.length >= 2) return `${parts[1]} ${parts[0]}`;
                return String(listPreferred);
            }
            const spoken =
                person.nameFormats?.spokenPreferredLocal ||
                person.nameFormats?.spokenOfficialLocal ||
                person.displayName ||
                person.name ||
                '';
            return spoken ? String(spoken) : '';
        }

        function formatBirth(person) {
            const nested = person.birth?.date?.date;
            if (nested) return nested;
            if (person.birthDateSort) {
                const sort = String(person.birthDateSort);
                if (sort.length === 8) {
                    return `${sort.slice(0, 4)}-${sort.slice(4, 6)}-${sort.slice(6, 8)}`;
                }
                return sort;
            }
            const display = person.birthDateDisplay;
            if (display !== null && display !== undefined && String(display).trim() !== '') {
                return display;
            }
            return null;
        }

        function unitNumberFromPerson(person) {
            for (const entry of person.households || []) {
                const num = entry.household?.unit?.unitNumber;
                if (num !== null && num !== undefined) return num;
            }
            return '';
        }

        function mapMember(person) {
            const unitNameRaw = person.membershipUnit?.nameLocal ?? person.unitName ?? '';
            const emailEntry = (person.emails || [])[0];
            const phoneEntry = (person.phones || [])[0];
            const inUnit = (person.households || []).some((h) => h.membershipUnitFlag === true);

            return {
                id: asEmpty(person.uuid ?? person.id),
                legacyId: asEmpty(person.mrn ?? person.legacyCmisId ?? person.legacyId),
                name: formatName(person),
                birth: formatBirth(person),
                age: asEmpty(person.age),
                email: asEmpty(emailEntry?.email ?? person.email),
                unitName: String(unitNameRaw).replace(' (PR)', '').trimEnd(),
                unitNumber: asEmpty(unitNumberFromPerson(person) || person.unitNumber),
                sex: asEmpty(person.sex ?? person.gender),
                phoneNumber: asEmpty(phoneEntry?.phone ?? phoneEntry?.e164Number ?? person.phoneNumber ?? person.phone),
                priesthoodOffice: asEmpty(
                    person.currentPriesthood?.priesthoodOfficeType ??
                    person.priesthoodOffice ??
                    person.priesthood
                ),
                isMember: person.statusFlags?.member ?? person.member ?? person.isMember ?? '',
                isOutOfUnitMember: person.statusFlags?.outOfUnitMember ?? person.outOfUnitMember ?? (inUnit ? false : ''),
            };
        }

        function extractList(data) {
            if (Array.isArray(data)) return data;
            if (!data || typeof data !== 'object') return [];
            if (Array.isArray(data.memberResults)) return data.memberResults;
            for (const key of ['results', 'members', 'data', 'individuals', 'items', 'content']) {
                if (Array.isArray(data[key])) return data[key];
            }
            return [];
        }

        async function fetchTerm(term) {
            try {
                const response = await fetch(`${memberLookupBase}${encodeURIComponent(term)}`, {
                    credentials: 'include',
                });
                if (!response.ok) return [];
                const payload = await response.json();
                return extractList(payload);
            } catch {
                return [];
            }
        }

        const terms = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i));
        const byId = new Map();
        let termIndex = 0;

        async function worker() {
            while (termIndex < terms.length) {
                const term = terms[termIndex++];
                const people = await fetchTerm(term);
                for (const person of people) {
                    const mapped = mapMember(person);
                    if (!mapped.id) continue;
                    if (!byId.has(mapped.id)) byId.set(mapped.id, mapped);
                }
            }
        }

        const workers = Math.min(concurrency, terms.length);
        await Promise.all(Array.from({ length: workers }, () => worker()));

        return Array.from(byId.values());
    }, MEMBER_LOOKUP_BASE, LOOKUP_CONCURRENCY);
}

async function getMembersData(user, pass) {
    const browser = await puppeteer.launch({ ...puppeteerConfig });
    const page = await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);

    try {
        const storedCookies = loadStoredSession(user);
        let loggedIn = false;

        if (storedCookies) {
            await applyCookies(page, storedCookies);
            await openMltContext(page);
            loggedIn = await sessionCanFetchMembers(page);
            if (!loggedIn) {
                clearStoredSession(user);
                await clearBrowserCookies(page);
            }
        }

        if (!loggedIn) {
            await performLogin(page, user, pass);
        }

        await enableLeanPage(page);
        let members = await fetchAllMembers(page);
        try {
            const enrichmentById = await fetchMemberListEnrichment(page);
            members = mergeMemberListEnrichment(members, enrichmentById);
        } catch (err) {
            console.warn('Member list enrichment skipped:', err.message);
        }
        const cookies = await page.cookies();
        await persistSession(user, cookies);

        return members;
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

module.exports = getMembersData;
