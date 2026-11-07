import type { NextAuthConfig } from "next-auth";
export const rebuildAuthConfig:NextAuthConfig={
 secret:process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET,
 trustHost:true,session:{strategy:"jwt"},pages:{signIn:"/login"},providers:[],
 callbacks:{
  jwt({token,user}){if(user){token.id=user.id;token.name=user.name;}return token;},
  session({session,token}){if(session.user&&typeof token.id==="string")session.user.id=token.id;return session;},
 },
};
