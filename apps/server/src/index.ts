import express from "express";
import cookieParser from "cookie-parser"
import { v4 as uuidv4, } from "uuid";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = 8000;
app.use(express.json());
app.use(cookieParser());

const token_extime = 15 * 60 * 10000;//somewhere here
const session_extime = 7 * 24 * 60 * 60 * 1000;
const tokens = new Map<string,{email:string,expiresAt:number}>
const JWT_SECRET = process.env.SECRET || "Test@123" ;
const FRONTEND = "http://localhost:3000";

function maketoken(email:string){
    const t = uuidv4();
    tokens.set(t,{email,expiresAt:Date.now() + token_extime});
    console.log(`[makeToken] created token=${t} for email=${email}; tokens.size=${tokens.size}`);
    return t;
}

setInterval(() => {
  const now = Date.now();
  for(const[key,value] of tokens ) if (value.expiresAt <= now){tokens.delete(key)}

},60_000).unref();


app.post("/api/v1/signin",(req,res) => {
  const email = String(req.body?.email ?? "");
  if(!email){
    return res.status(400).json({
      error:"invalid email"
    })
  }
  const token = maketoken(email);
  const link = `http://localhost:${PORT}/api/v1/signin/post?token=${encodeURIComponent(token)}`;
  console.log("Magic Link is:",link,"For Email",email);

  return res.json({ ok:true, message:"Magic link Generated" })
} )

app.get("/api/v1/signin/post",(req,res) => {
  const token = String(req.query.token ?? "");
  const row = tokens.get(token);
  console.log("tokens size",tokens.size )
  console.log("Token",token)
  console.log("row",row)
  if(!row || Date.now() >= row.expiresAt){
    return res.status(400).send("invalid token or link expired");
  }

  const session = jwt.sign({email:row.email},JWT_SECRET,{ expiresIn:100000});

  res.cookie("session",session,{
    httpOnly:true,
    maxAge:session_extime,
  })
tokens.delete(token);

  return res.redirect(FRONTEND);

} )

app.get("/api/v1/me",(req,res) => {
  const token = req.cookies?.session;
  if(!token){
    res.status(401).json({ok:false});
  }
try {

  const verify = jwt.verify(token,JWT_SECRET) as {email:string};
  return res.json({ok:true,email:verify.email})

}
 catch (error) {
  console.error(error)
  return res.status(401).json({ok:false})
}
} )

app.listen(PORT,() => {
  console.log(`server running on PORT ${PORT}`);
} )
