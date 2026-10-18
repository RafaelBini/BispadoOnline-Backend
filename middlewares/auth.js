const jwt = require("jsonwebtoken");

function verifyJWT(req, res, next) {
    const authorization = req.get("authorization");
    const bearerToken = authorization && authorization.match(/^Bearer\s+(.+)$/i);
    const token = req.get("x-access-token") || (bearerToken && bearerToken[1]);

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
