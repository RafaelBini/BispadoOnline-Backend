const jwt = require("jsonwebtoken");

function verifyJWT(req, res, next) {
    // Temporaily removed the login verification
    //const token = req.headers["x-access-token"];
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiaWF0IjoxNzM4NTE2ODAxLCJleHAiOjE3NjQ0MzY4MDF9.Vx952F4ZyO4K4LwDEpNkq63c0h0dhJxERolM1Ce24NU';

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