const fs = require('fs') //
const puppeteer = require('puppeteer');
require('dotenv-safe').config({
    allowEmptyValues: true,
});
const puppeteerConfig = {
    headless: false,
    args: [
        '--no-sandbox',
        "--disable-gpu",
        "--single-process",
        "--no-zygote"
    ]
}
const DEFAULT_TIMEOUT = (1000 * 60 * 3);

async function getMembersData(user, pass, unitNumber) {
    const browser = await puppeteer.launch({ ...puppeteerConfig, headless: true });
    const page = await browser.newPage();

    await page.goto('https://lcr.churchofjesuschrist.org')

    await page.waitForSelector('input[name="identifier"]', { timeout: DEFAULT_TIMEOUT });
    await page.focus('input[name="identifier"]');
    await page.keyboard.type(user, { delay: 50 });

    await page.waitForSelector('input[type="submit"]', { timeout: DEFAULT_TIMEOUT });
    await page.click('input[type="submit"]');

    await page.waitForSelector('input[type="password"]', { timeout: DEFAULT_TIMEOUT });
    await page.focus('input[type="password"]');
    await page.keyboard.type(pass, { delay: 50 });

    await page.waitForSelector('input[type=submit]', { timeout: DEFAULT_TIMEOUT });
    await page.click("input[type=submit]");

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