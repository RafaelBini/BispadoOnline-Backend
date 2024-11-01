const express = require('express');
require('dotenv-safe').config()
const db = require('./database.js');
const jwt = require('jsonwebtoken');
var cors = require('cors');
var nodemailer = require('nodemailer');
const auth = require("./middlewares/auth");
const getMembersData = require("./church_data_fetch");

// #region EMAILER
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
// #endregion

// #region EXPRESS
const app = express();
var server;
if (process.env.NODE_ENV == 'DEV') {
    server = require('http').createServer(app);
}
if (process.env.NODE_ENV == 'PROD') {
    const options = {
        cert: fs.readFileSync('/etc/letsencrypt/live/fifasbroken.binisoft.com.br/fullchain.pem'),
        key: fs.readFileSync('/etc/letsencrypt/live/fifasbroken.binisoft.com.br/privkey.pem')
    }
    server = require('https').createServer(options, app);
}
// #endregion

// #region MIDDLEWARES
app.use(express.json());
app.use(cors());
// #endregion

// #region FUNCTIONS
function createEmailToken() {
    var token = '';
    for (let i = 1; i <= 5; i++) {
        token += Math.floor(Math.random() * 10)
    }
    return token
}
function createJwtToken(id) {
    return jwt.sign({ id }, process.env.SECRET, {
        expiresIn: 60 * 60 * 24 * 30 * 10 // 10 months in seconds
    });
}
// #endregion

// #region Authentication
app.post('/send-email-token', async (req, res) => {

    // Check if has email
    if (!req.body.email) return res.status(400).json({ msg: "Email vazio" });

    // Check if user exists
    var users = await db.fetch('users', `email='${req.body.email}'`, '')
    if (users.length <= 0) return res.status(400).json({ msg: "Email não registrado" });


    const token = createEmailToken();

    // Enivar e registrar token 
    try {
        var mailOptions = {
            from: 'alaparquedafonte@gmail.com',
            to: 'rfabini1996@gmail.com',
            subject: 'Bipado Online Token',
            html: 'Use este código para entrar: ' + token
        };


        transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                console.log('Email error: ' + error);
            } else {
                console.log('Email sent: ' + info.response);
                db.update('users', { id: users[0].id, emailed_token: token }, '')
            }
        });

        return res.status(200)
            .json({ msg: "Email sent to " + users[0].email });
    }
    catch (ex) {
        return res.status(400)
            .json({ msg: "Email failed " });
    }


})
app.post('/validate-email-token', async (req, res) => {

    var users = await db.fetch('users', `emailed_token='${req.body.token}' and email='${req.body.email}'`, '',)
    if (users.length <= 0) return res.status(400).json({ msg: "Invalid token" });

    return res.status(200).json({ msg: "Token accepted", jwt_token: createJwtToken(users[0].id) });
})
// #endregion

// #region MEMBERS KEEPER ENDPOINT
app.post('/load-members-data', auth, async (req, res) => {
    // VALIDATE CHURCH USER/PASSWORD
    const user = req.body.churchUser;
    const pass = req.body.churchPass;
    if (!user || !pass) {
        return res.status(400).json({ msg: "churchUser or churchPass are empty" })
    }

    // TRY TO FETCH DATA
    try {
        var members = await getMembersData(user, pass)
        members = members.map(m => {
            return {
                id: m.id,
                legacyId: m.legacyId,
                name: m.name,
                sex: m.sex,
                birth: m.birth
            }
        })
        for (let member of members) {
            await db.set('members', member, req.userId)
        }

        return res.status(200).json({ msg: 'Members data loaded' });
    }
    catch (ex) {
        console.log(ex)
        return res.status(400).json(ex);
    }

})
// #endregion

// #region DATABASE ENDPOINTS

app.get('/my-user', auth, async (req, res) => {
    try {
        var user = await db.get('users', req.userId, '');
        return res.json(user)
    }
    catch (ex) {
        return res.status(400).json(ex)
    }

})

app.get('/:tableName/:id', auth, async (req, res) => {
    try {
        res.json(await db.get(req.params.tableName, req.params.id, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})

app.delete('/:tableName/:id', auth, async (req, res) => {
    try {


        res.json(await db.del(req.params.tableName, req.params.id, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})

app.post('/:tableName/delete-where', auth, async (req, res) => {
    try {


        res.json(await db.deleteWhere(req.params.tableName, req.body.whereStr, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})

app.post('/:tableName/fetch', auth, async (req, res) => {
    try {


        res.json(await db.fetch(req.params.tableName, req.body.whereStr, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})

app.post('/:tableName/set', auth, async (req, res) => {
    try {


        res.json(await db.set(req.params.tableName, req.body, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})

app.post('/:tableName/add', auth, async (req, res) => {
    try {


        res.json(await db.add(req.params.tableName, req.body, req.userId))
    }
    catch (ex) {
        return res.status(400).json(ex)
    }
})
// #endregion

// #region SPEECHES ENDPOINTS
function getSundayOfTheMonth(date) {
    // Create a new Date object from the input date
    const targetDate = new Date(date);

    // Get the year, month, and day of the target date
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const day = targetDate.getDate();

    // Create a new Date object for the first day of the month
    const firstDayOfMonth = new Date(year, month, 1);

    // Calculate the day of the week for the first day of the month (0 = Sunday, 1 = Monday, ...)
    const firstDayWeekDay = firstDayOfMonth.getDay();

    // Calculate the difference in days between the first day of the month and the first Sunday
    const daysToFirstSunday = (7 - firstDayWeekDay) % 7;

    // Create a new Date object for the first Sunday of the month
    const firstSunday = new Date(year, month, 1 + daysToFirstSunday);

    // Calculate the difference in milliseconds between the target date and the first Sunday
    const timeDiff = targetDate.getTime() - firstSunday.getTime();

    // Calculate the number of weeks between the target date and the first Sunday
    const weeksDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 7));

    // Add 1 to the weeks difference to get the Sunday number of the month
    const sundayOfTheMonth = weeksDiff + 1;

    return sundayOfTheMonth;
}
app.post('/generate-sacramentals', auth, async (req, res) => {
    try {

        const curr_date = new Date();
        var process_date = null;
        for (let i = -800; i <= 1000; i++) {

            process_date = new Date(curr_date.getTime() + (1000 * 60 * 60 * 24 * i))

            // Sunday
            if (process_date.getDay() == 0) {
                var sacramentalId = process_date.toLocaleDateString('en-CA').replaceAll('-', '');
                var exists = await db.get('sacramentals', sacramentalId, '');
                if (exists) continue;

                await db.set('sacramentals', { id: sacramentalId, date: process_date, sundayOfTheMonth: getSundayOfTheMonth(process_date) }, '')
            }
        }

        return res.json({ msg: 'Sacramentals generated' })

    }
    catch (ex) {
        return res.status(500).json(ex)
    }
})
app.post('/speeches_view_fetch', auth, async (req, res) => {
    try {

        return res.json(await db.fetch('speeches_view', req.body.whereStr, ''))

    }
    catch (ex) {
        console.log(ex)
        return res.status(500).json(ex)
    }
})
// #endregion


// Iniciar o servidor
const PORT = 4500;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});