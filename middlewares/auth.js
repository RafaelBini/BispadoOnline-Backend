const jwt = require("jsonwebtoken");

function verifyJWT(req, res, next) {
    // Temporaily removed the login verification
    //const token = req.headers["x-access-token"];
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiaWF0IjoxNzY0OTU3NzQ5LCJleHAiOjE3OTA4Nzc3NDl9.27SGGMvYVWt3cv6LihPJeKxZuuOVta1YihzbIxHRYYM';

    if (!token) return res.status(401).json({ msg: "Token undefined" });
    jwt.verify(token, process.env.SECRET, (err, decoded) => {
        if (err)
            return res
                .status(401)
                .json({ msg: "Failed when trying to authenticate." });
        req.userId = decoded.id;
        next();
    });
}

module.exports = verifyJWT;