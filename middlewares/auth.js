const jwt = require("jsonwebtoken");

function verifyJWT(req, res, next) {
    const token = req.headers["x-access-token"];
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