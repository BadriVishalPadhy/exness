import { Router } from "express";
import { SignInSchema } from "../../types";
import jwt, { JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";



const authRouter:Router = Router();
dotenv.config();

authRouter.post("/signin", (req, res) => {
  const { data, success } = SignInSchema.safeParse(req.body);
  if (!success) {
    res.status(411).json({
      message: "wrong creds",
    });
    return;
  }
  const token = jwt.sign({ email: data.email }, process.env.JWT_SECRET!);
  const link = `${process.env.BACKEND_URL}/api/v1/signin/post?token=${encodeURIComponent(token)}`;
  console.log("Magic link is:", link);
  res.json({ message: "signed in suceesfully" });
});

authRouter.get("/signin/post", (req, res) => {
  const token = req.query.token as string;
  try {
    const email = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    const authToken = jwt.sign(email,process.env.JWT_SECRET!)
    console.log("token",token);
    console.log("email",email);
    console.log("authToken",authToken);
    res.cookie("authToken",authToken,{
      httpOnly:true,
      secure:false,
      sameSite:"lax"
    })

    return res.redirect(`${process.env.FRONTEND_URL}`);


  } catch (error) {
    console.error(error);
    res.status(511).json({message:"error while decoding jwt"})
  }
});
 export default authRouter;


