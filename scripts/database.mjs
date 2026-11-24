import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migrations=["0000_hotel_search","0001_continuation","0002_factorial"];
export function localDB(file=":memory:"){
  const conn=new DatabaseSync(file);
  conn.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  const applied=conn.prepare("PRAGMA user_version").get().user_version;
  for(let i=applied;i<migrations.length;i++){
    conn.exec("BEGIN IMMEDIATE");
    try{
      conn.exec(readFileSync(new URL("../drizzle/"+migrations[i]+".sql",import.meta.url),"utf8"));
      conn.exec("PRAGMA user_version="+(i+1)+"; COMMIT");
    }catch(error){
      conn.exec("ROLLBACK");
      throw error;
    }
  }
  function statement(sql,params=[]){
    const q=conn.prepare(sql);
    return {bind(...values){return statement(sql,values);},first(){return q.get(...params)||null;},
      all(){return {results:q.all(...params)};},run(){return q.run(...params);}};
  }
  return {prepare:statement,batch(statements){
    conn.exec("BEGIN IMMEDIATE");
    try{const result=statements.map(s=>s.run());conn.exec("COMMIT");return result;}
    catch(error){conn.exec("ROLLBACK");throw error;}
  },close(){conn.close();}};
}
