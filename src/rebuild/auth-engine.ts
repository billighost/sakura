import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getRebuildPool } from "./data/db";
import { rebuildAuthConfig } from "./auth-config";
export const {handlers,auth,signIn,signOut}=NextAuth({
 ...rebuildAuthConfig,
 providers:[Credentials({credentials:{identifier:{type:"text"},password:{type:"password"}},
  async authorize(credentials){
   const identifier=credentials?.identifier;const password=credentials?.password;
   if(typeof identifier!=="string"||typeof password!=="string"||identifier.length>254||password.length>256)return null;
   const found=await getRebuildPool().query('SELECT id, username, email, "passwordHash" FROM public."User" WHERE lower(username)=$1 OR lower(email)=$1 LIMIT 1',[identifier.trim().toLowerCase()]);
   const user=found.rows[0];if(!user||!await bcrypt.compare(password,user.passwordHash))return null;
   return {id:user.id,name:user.username,email:user.email};
  },
 })],
});
