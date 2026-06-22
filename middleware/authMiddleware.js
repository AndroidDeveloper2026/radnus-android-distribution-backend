const jwt = require("jsonwebtoken");
const Register = require("../models/Register");

module.exports = async function (req, res, next) {
  try {
    const authHeader = req.header("Authorization");
    
    if (!authHeader) {
      return res.status(401).json({ msg: "No token, access denied" });
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : authHeader;

    if (!token) {
      return res.status(401).json({ msg: "No token, access denied" });
    }

    // ✅ DECODE TOKEN
    const decoded = jwt.verify(token, process.env.ACCESS_SECRET);

    // ✅ FETCH FULL USER FROM DATABASE (NOT JUST TOKEN DATA)
    // This gives us access to ALL user fields including:
    // - status, isActive, registrationType, employeeId, etc.
    const user = await Register.findById(decoded.id).select("-password");
    
    if (!user) {
      return res.status(401).json({ msg: "User not found" });
    }

    // ✅ ATTACH COMPLETE USER OBJECT TO REQ
    // Now req.user has ALL user data, not just { id, role }
    req.user = {
      ...user.toObject(),
      id: user._id.toString(),  // Ensure id is available as string
    };

    next();
  } catch (err) {
    console.error("❌ Auth Middleware Error:", err);
    return res.status(401).json({ msg: "Token is not valid" });
  }
};

//------------------------------------------------------

// // const jwt = require("jsonwebtoken");

// // module.exports = function (req, res, next) {
// //   const token = req.header("Authorization");

// //   if (!token) {
// //     return res.status(401).json({ msg: "No token, access denied" });
// //   }

// //   try {
// //     const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
// //     req.user = decoded;
// //     next();
// //   } catch (err) {
// //     res.status(401).json({ msg: "Token is not valid" });
// //   }
// // };

// //---------------------------below is working old -----------------------------

// const jwt = require("jsonwebtoken");

// module.exports = function (req, res, next) {
//   // Get token from header
//   const authHeader = req.header("Authorization");
  
//   // Check if no token
//   if (!authHeader) {
//     return res.status(401).json({ msg: "No token, access denied" });
//   }

//   // Extract token (remove 'Bearer ' prefix if present)
//   const token = authHeader.startsWith('Bearer ') 
//     ? authHeader.substring(7) 
//     : authHeader;

//   if (!token) {
//     return res.status(401).json({ msg: "No token, access denied" });
//   }

//   try {
//     // Use ACCESS_SECRET (not JWT_SECRET) - same as in generateAccessToken
//     const decoded = jwt.verify(token, process.env.ACCESS_SECRET);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     return res.status(401).json({ msg: "Token is not valid" });
//   }
// };

