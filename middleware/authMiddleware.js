// const jwt = require("jsonwebtoken");

// module.exports = function (req, res, next) {
//   const token = req.header("Authorization");

//   if (!token) {
//     return res.status(401).json({ msg: "No token, access denied" });
//   }

//   try {
//     const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     res.status(401).json({ msg: "Token is not valid" });
//   }
// };

const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  // Get token from header
  const authHeader = req.header("Authorization");
  
  // Check if no token
  if (!authHeader) {
    return res.status(401).json({ msg: "No token, access denied" });
  }

  // Extract token (remove 'Bearer ' prefix if present)
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : authHeader;

  if (!token) {
    return res.status(401).json({ msg: "No token, access denied" });
  }

  try {
    // Use ACCESS_SECRET (not JWT_SECRET) - same as in generateAccessToken
    const decoded = jwt.verify(token, process.env.ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ msg: "Token is not valid" });
  }
};