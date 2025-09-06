const fs = require('fs') //
const puppeteer = require('puppeteer');
require('dotenv-safe').config({
    allowEmptyValues: true,
});
var puppeteerConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        "--disable-gpu",
        "--single-process",
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--no-zygote'
    ]
}
if (process.env.NODE_ENV == 'PROD') {
    puppeteerConfig.executablePath = '/snap/bin/chromium'
}
const DEFAULT_TIMEOUT = (1000 * 60 * 1);

async function getMembersData(user, pass, unitNumber) {
    const browser = await puppeteer.launch({ ...puppeteerConfig });
    const page = await browser.newPage();

    await page.goto('https://lcr.churchofjesuschrist.org')

    await page.waitForSelector('input[name="username"]', { timeout: DEFAULT_TIMEOUT });
    await page.focus('input[name="username"]');
    await page.keyboard.type(user, { delay: 50 });

    await page.waitForSelector('button[id="button-primary"]', { timeout: DEFAULT_TIMEOUT });
    await page.click('button[id="button-primary"]');

    await page.waitForSelector('input[type="password"]', { timeout: DEFAULT_TIMEOUT });
    await page.focus('input[type="password"]');
    await page.keyboard.type(pass, { delay: 50 });

    await page.waitForSelector('button[id="button-primary"]', { timeout: DEFAULT_TIMEOUT });
    await page.click('button[id="button-primary"]');

    await page.waitForSelector('input[type=search]', { timeout: DEFAULT_TIMEOUT });

    const members = await page.evaluate((unitNumber) => {
        return new Promise((resolve, reject) => {

            const UNIT_NUMBER = unitNumber;

            var list = [];

            function reqListener() {
                list = JSON.parse(this.responseText);
                list = list.map(p => {
                    return {
                        id: p.uuid,
                        legacyId: p.legacyCmisId,
                        name: `${p.nameListPreferredLocal.split(', ')[1]} ${p.nameListPreferredLocal.split(', ')[0]}`,
                        birth: p.birth.date.date,
                        age: p.age,
                        email: p.email,
                        unitName: p.unitName.replace(" (PR)", "").trimEnd(),
                        unitNumber: p.unitNumber,
                        sex: p.sex,
                        phoneNumber: p.phoneNumber,
                        priesthoodOffice: p.priesthoodOffice,
                        isMember: p.member,
                        isOutOfUnitMember: p.outOfUnitMember
                    }

                });

                resolve(list)
            }

            var oReq = new XMLHttpRequest();
            oReq.addEventListener("load", reqListener);
            oReq.open("GET", `https://lcr.churchofjesuschrist.org/api/umlu/report/member-list?lang=por&stakeWideSubOrgType=ALL&unitNumber=${UNIT_NUMBER}`);
            oReq.send();
        })


    }, unitNumber)

    await page.close()
    await browser.close()

    return members;
}


module.exports = getMembersData;