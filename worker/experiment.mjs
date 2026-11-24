export const STUDY_VERSION = "lisbon-2026-11-v3";
export const STUDY_CONSENT = "rua-stays-consent-v3";
export const CRITICAL_RANK = 7;
export const INACTIVITY_MS = 30 * 60 * 1000;
export const EXPOSURE_RULE = {fraction: 0.5, milliseconds: 1000};
export const ARMS = [
  {id:"high_retarget", focal_quality:"high", retarget:1},
  {id:"high_no_retarget", focal_quality:"high", retarget:0},
  {id:"low_retarget", focal_quality:"low", retarget:1},
  {id:"low_no_retarget", focal_quality:"low", retarget:0},
];
export const TRIP = {
  checkIn:"2026-12-02", checkOut:"2026-12-03", adults:2, rooms:1,
  sort:"recommended", stars:[], minScore:0, maxTotal:0, freeCancellation:false,
};
export const ROOM = {
  id:"double-flex", name:"Standard double room", bed:"1 double bed", size:20, capacity:2,
  euros:100, includes:["Private bathroom","Air conditioning","Free Wi-Fi","Free cancellation"],
};
// The source rank identifies the row in Booking_Lisbon_Hotel_Experiment.xlsx.
// Booking rating cues are retained. Names, photography, room and rates are study stimuli.
const evidence = [
  ["H","Pátio do Sol",19,"TURIM Lisboa Hotel",4,9.1,9.5,9.6,9.2],
  ["L","Casa da Brisa",11,"SANA Rex Hotel",3,8.1,8.6,8.3,8.0],
  ["M1","Vila do Cedro",2,"SANA Metropolitan Hotel",4,8.7,9.1,9.0,8.8],
  ["M2","Pátio da Lua",3,"Eurostars Lisboa Parque",4,8.4,8.8,8.8,8.4],
  ["M3","Casa Olival",4,"SANA Malhoa Hotel",4,8.7,9.1,9.1,8.9],
  ["M4","Jardim do Cobre",7,"HF Fénix Lisboa",4,8.6,8.9,9.0,8.7],
  ["M5","Largo da Lapa",9,"Dorma Liberdade",3,8.6,9.0,8.9,8.7],
  ["M6","Vila Calçada",12,"Ibis Styles Lisboa Centro Marquês de Pombal",3,8.7,9.0,8.9,8.6],
  ["M7","Casa da Vela",10,"America Diamonds Hotel",3,8.4,8.8,8.7,8.4],
  ["M8","Casa do Arco",15,"TURIM Saldanha Hotel",4,8.7,9.0,9.0,8.7],
  ["M9","Jardim Aurora",16,"Holiday Inn Express & Suites Lisbon Príncipe Real by IHG",3,8.7,9.1,9.2,8.9],
  ["M10","Pátio do Norte",18,"Hotel Avenida Park",3,8.8,9.2,9.1,8.8],
  ["M11","Largo das Flores",1,"HF Fénix Music",3,9.0,9.4,9.4,9.2],
  ["M12","Vila do Prado",14,"The Cloud One Lisbon",4,9.0,9.4,9.5,9.0],
];
export const HOTELS = Object.fromEntries(evidence.map((row,index)=>{
  const [id,name,sourceRank,sourceHotel,stars,score,cleanliness,comfort,facilities] = row;
  const photo = "/photos/room-" + String(index+1).padStart(2,"0") + ".webp";
  return [id,{id,name,photo,sourceRank,sourceHotel,stars,score,cleanliness,comfort,facilities}];
}));
export function randomArm(){
  const n = crypto.getRandomValues(new Uint8Array(1))[0];
  return ARMS[n & 3];
}
export function initialOrder(arm){
  const focal = arm.focal_quality === "high" ? "H" : "L";
  return [focal,"M1","M2","M3","M4","M5",arm.retarget ? focal : "M6","M7","M8","M9","M10","M11","M12"];
}
export function normalizeQuery(input={}){
  if (!input || typeof input !== "object") throw new Error("Search parameters are required.");
  const checkIn=input.checkIn ?? TRIP.checkIn, checkOut=input.checkOut ?? TRIP.checkOut;
  const date=value=>typeof value==="string" && /^2026-12-(0[1-9]|[12][0-9]|3[01])$/.test(value);
  if (!date(checkIn) || !date(checkOut) || checkOut<=checkIn) throw new Error("Choose a stay within December 2026, with checkout after check-in.");
  const range=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
  const adults=input.adults ?? TRIP.adults, rooms=input.rooms ?? TRIP.rooms;
  const sort=input.sort ?? TRIP.sort, stars=input.stars ?? [], minScore=input.minScore ?? 0, maxTotal=input.maxTotal ?? 0;
  if (!range(adults,1,4) || !range(rooms,1,2)) throw new Error("Choose 1–4 adults and 1–2 rooms.");
  if (!["recommended","scores","stars","price"].includes(sort) || !Array.isArray(stars) ||
      stars.some(n=>n!==3&&n!==4) || ![0,8.5,9].includes(minScore) || !range(maxTotal,0,3000)){
    throw new Error("Choose a supported filter or sort option.");
  }
  return {checkIn,checkOut,adults,rooms,sort,stars:[...new Set(stars)].sort(),minScore,maxTotal,freeCancellation:input.freeCancellation===true};
}
export function nightsFor(query){return Math.round((Date.parse(query.checkOut)-Date.parse(query.checkIn))/86400000);}
export function priceFor(query){return ROOM.euros*nightsFor(query);}
export function configuredRows(sequence,query){
  const total=priceFor(query);
  if(query.adults>ROOM.capacity || query.rooms!==1 || (query.maxTotal && total>query.maxTotal))return [];
  const entries=sequence.map((hotel_id,i)=>({hotel_id,default_rank:i+1,listing_instance_id:"p"+String(i+1).padStart(2,"0")}));
  const included=entries.filter(x=>(!query.stars.length||query.stars.includes(HOTELS[x.hotel_id].stars)) && HOTELS[x.hotel_id].score>=query.minScore);
  if(query.sort==="scores")included.sort((a,b)=>HOTELS[b.hotel_id].score-HOTELS[a.hotel_id].score);
  if(query.sort==="stars")included.sort((a,b)=>HOTELS[b.hotel_id].stars-HOTELS[a.hotel_id].stars);
  return included.map((x,i)=>({...x,actual_rank:i+1}));
}
export function publicHotel(id){
  const {sourceRank,sourceHotel,...hotel}=HOTELS[id];
  // Public property URLs carry listing instance IDs. Keep the internal role outside the payload.
  const {id:internal,...attributes}=hotel;
  return attributes;
}
