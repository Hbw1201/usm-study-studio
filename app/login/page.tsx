import {redirect} from "next/navigation";
import {getAccountUser} from "../../lib/account-auth";
import LoginForm from "./login-form";

export const dynamic="force-dynamic";
export const metadata={title:"登录 · 知习学习空间"};

export default async function LoginPage(){
  const user=await getAccountUser();
  if(user)redirect("/");
  return <LoginForm/>;
}
