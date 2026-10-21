import StudyApp from "./study-app";
import {requireAccountUser} from "../lib/account-auth";
export const dynamic="force-dynamic";
export default async function Home(){const user=await requireAccountUser();return <StudyApp key={user.userId} userKey={user.userId} displayName={user.displayName}/>;}
