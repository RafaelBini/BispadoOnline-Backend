const express = require('express');
const session = require('express-session');
require('dotenv-safe').config()
const db = require('./database.js');
const jwt = require('jsonwebtoken');
var cors = require('cors');
const fs = require('fs'); //
var nodemailer = require('nodemailer');
const auth = require("./middlewares/auth");
const getMembersData = require("./church_data_fetch");

// EMAILER
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// EXPRESS
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

// MIDDLEWARES
app.use(express.json());
app.use(cors());

// FUNCTIONS
function createToken() {
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

// Authentication
app.post('/send-email-token', async (req, res) => {

    // Check if has email
    if (!req.body.email) return res.status(400).json({ msg: "Email vazio" });

    // Check if user exists
    var users = await db.get('users', req.body.email, req.body.email)
    if (!users) return res.status(400).json({ msg: "Email não registrado" });


    const token = createToken();

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
                db.update('users', { id: req.body.email, emailed_token: token }, req.body.email)
            }
        });

        return res.status(200)
            .json({ msg: "Email sent" });
    }
    catch (ex) {
        return res.status(400)
            .json({ msg: "Email failed " });
    }


})
app.post('/validate-email-token', async (req, res) => {

    var users = await db.fetch('users', `emailed_token='${req.body.token}'`, req.body.email,)
    if (users.length <= 0) return res.status(400).json({ msg: "Invalid token" });

    return res.status(200).json({ msg: "Token accepted", jwt_token: createJwtToken(req.body.email) });
})

// MEMBERS KEEPER ENDPOINT
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

// DATABASE ENDPOINTS

app.get('/:tableName/:id', auth, async (req, res) => {
    res.json(await db.get(req.params.tableName, req.params.id, req.userId))
})

app.delete('/:tableName/:id', auth, async (req, res) => {
    res.json(await db.del(req.params.tableName, req.params.id, req.userId))
})

app.post('/:tableName/delete-where', auth, async (req, res) => {
    res.json(await db.deleteWhere(req.params.tableName, req.body.whereStr, req.userId))
})

app.post('/:tableName/fetch', auth, async (req, res) => {
    res.json(await db.fetch(req.params.tableName, req.body.whereStr, req.userId))
})

app.post('/:tableName/set', auth, async (req, res) => {
    res.json(await db.set(req.params.tableName, req.body, req.userId))
})

app.post('/:tableName/add', auth, async (req, res) => {
    res.json(await db.add(req.params.tableName, req.body, req.userId))
})


// Iniciar o servidor
const PORT = 4500;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});