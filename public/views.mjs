export const html=v=>String(v??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
export const money=value=>new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value);
const dateFormat=new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",weekday:"short",timeZone:"UTC"});
const dateLabel=value=>dateFormat.format(new Date(value+"T12:00:00Z"));
const unit=(n,word)=>n+" "+word+(n===1?"":"s");
const guestText=q=>unit(q.adults,"adult")+" · "+unit(q.rooms,"room");
const dates=q=>dateLabel(q.checkIn)+" – "+dateLabel(q.checkOut);
const nightText=l=>unit(l.nights,"night");
const checked=selected=>selected?" checked":"";
const valid=selected=>selected?" selected":"";
const stars=n=>'<span aria-label="'+n+'-star hotel" class="stars">'+"★".repeat(n)+'</span>';
const rating=h=>h.score>=9?"Excellent":"Very good";
const ratingBadge=h=>'<strong class="rating-badge" aria-label="'+h.score.toFixed(1)+' out of 10">'+h.score.toFixed(1)+'</strong>';
const call=(label,control,extra="",style="primary")=>'<button class="'+style+'" data-control="'+control+'" '+extra+'>'+label+'</button>';
const link=(url,label,control,extra="",style="text-link")=>'<a class="'+style+'" href="'+html(url)+'" data-control="'+control+'" '+extra+'>'+label+'</a>';
const cardMark=id=>'data-instance="'+id+'"';
const cents=total=>money(total);
const roomFacts=r=>'<ul class="room-facts">'+[r.bed,r.size+" m²",...r.includes].map(x=>'<li>'+html(x)+'</li>').join("")+'</ul>';
export function consentPage(){
  return '<div class="frame consent"><section class="box"><p class="kicker">Research study</p><h1>Find a hotel for a night in Lisbon</h1><p>Imagine you and a travel companion need a double room near Parque Eduardo VII for 2–3 December. Your budget is €120 for the stay. Browse the hotels as you normally would and choose an option if you find one that suits you.</p><p>Rua Stays offers simulated reservations using supplied test guest details. This study records the listings you view, how long you spend, your clicks and your choices on this site after you agree. You can end the search at any point.</p><form id="consent"><label class="consent-choice"><input type="checkbox" required> <span>I agree to take part and to the recording of my interactions on this site.</span></label>'+call("View search results","consent_agree",'type="submit"')+'</form></section></div>';
}
function queryForm(q){
  return '<form class="trip-search" id="trip-search" aria-label="Search stays">'+
    '<div class="trip-destination"><span>Destination</span><strong>Parque Eduardo VII, Lisbon</strong></div>'+
    '<label>Check-in<input name="checkIn" type="date" value="'+q.checkIn+'" min="2026-12-01" max="2026-12-31" required></label>'+
    '<label>Check-out<input name="checkOut" type="date" value="'+q.checkOut+'" min="2026-12-01" max="2026-12-31" required></label>'+
    '<label>Adults<select name="adults">'+[1,2,3,4].map(n=>'<option value="'+n+'"'+valid(n===q.adults)+'>'+n+'</option>').join("")+'</select></label>'+
    '<label>Rooms<select name="rooms"><option value="1"'+valid(q.rooms===1)+'>1</option><option value="2"'+valid(q.rooms===2)+'>2</option></select></label>'+
    call("Search","search_submit",'type="submit"')+'</form>';
}
const sortLabels={recommended:"Recommended",scores:"Highest guest rating",stars:"Highest star rating",price:"Lowest total price"};
function filterPanel(q){
  return '<aside class="sidebar"><form class="filter-form box" id="filters" aria-label="Filter properties"><h2>Filter by</h2>'+
    '<fieldset><legend>Total price</legend><label class="field">Maximum for your stay (EUR)<input name="maxTotal" type="number" min="1" max="3000" step="1" value="'+(q.maxTotal||"")+'" placeholder="Any price"></label></fieldset>'+
    '<fieldset><legend>Guest rating</legend><select name="minScore" aria-label="Minimum guest rating">'+[[0,"All ratings"],[8.5,"8.5 and above"],[9,"9.0 and above"]].map(([v,l])=>'<option value="'+v+'"'+valid(q.minScore===v)+'>'+l+'</option>').join("")+'</select></fieldset>'+
    '<fieldset><legend>Property rating</legend>'+[3,4].map(n=>'<label class="checkline"><input type="checkbox" name="stars" value="'+n+'"'+checked(q.stars.includes(n))+'> '+n+' stars</label>').join("")+'</fieldset>'+
    '<fieldset><legend>Booking terms</legend><label class="checkline"><input name="freeCancellation" type="checkbox"'+checked(q.freeCancellation)+'> Free cancellation</label></fieldset>'+
    '<div class="filter-actions">'+call("Apply filters","filter_apply",'type="submit"')+call("Clear filters","filter_clear",'type="button"',"text-button")+'</div></form></aside>';
}
function hotelCard(s,e,nav){
  const {id,hotel:h,rank}=e, open=nav("/hotel/"+id), reviews=open+"#guest-ratings", rooms=open+"#room-options";
  return '<article class="hotel-card box" id="listing-'+id+'" '+cardMark(id)+' data-card="'+id+'">'+
    link(open,'<img src="'+h.photo+'" alt="Double room at '+html(h.name)+'" width="404" height="303" '+(rank>3?'loading="lazy"':'')+'>',"hotel_image",'',"hotel-image")+
    '<div class="card-main"><div class="card-title">'+stars(h.stars)+'<h2>'+link(open,html(h.name),"hotel_name",'')+'</h2></div>'+
    '<p class="card-area">Parque Eduardo VII area, Lisbon</p><div class="card-room"><strong>'+s.room.name+'</strong><span>'+s.room.bed+' · private bathroom</span><span class="cancellation">Free cancellation</span></div></div>'+
    '<div class="card-offer">'+link(reviews,'<span>'+rating(h)+'</span>'+ratingBadge(h),"hotel_rating",'',"rating-link")+
    '<div class="offer-price"><span>'+nightText(s.list)+' · '+unit(s.list.query.adults,"adult")+'</span><strong>'+cents(s.list.total)+'</strong><small>Includes taxes and fees</small>'+
    link(rooms,"View availability","hotel_availability",'',"primary")+'</div></div></article>';
}
export function resultsPage(s,nav){
  const q=s.list.query, n=s.list.entries.length, applied=q.stars.length||q.minScore||q.maxTotal||q.freeCancellation;
  const sort='<label class="sort-control"><span>Sort by</span><select name="sort" id="sort" data-control="sort_change">'+Object.entries(sortLabels).map(([k,v])=>'<option value="'+k+'"'+valid(q.sort===k)+'>'+v+'</option>').join("")+'</select></label>';
  return '<div class="trip-bar"><div class="frame">'+queryForm(q)+'</div></div><div class="frame results-shell">'+filterPanel(q)+
    '<section class="results-list" aria-labelledby="result-heading"><div class="results-heading"><div><p class="crumb">Portugal / Lisbon / Parque Eduardo VII</p><h1 id="result-heading">Stays near Parque Eduardo VII</h1><p>'+unit(n,"result")+(applied?" · Filters applied":"")+'</p></div>'+sort+'</div>'+
    '<div class="cards">'+(n?s.list.entries.map(e=>hotelCard(s,e,nav)).join(""):'<div class="box empty"><h2>No stays match your search</h2><p>Try a different budget, rating or guest count for this trip.</p>'+call("Reset search","search_reset")+'</div>')+'</div></section></div>';
}
function propertyHeader(s,e,nav){
  const {hotel:h,id}=e, back=nav("/search")+"#listing-"+id;
  return '<div class="breadcrumbs">'+link(back,"Search results","return_to_results")+'<span> / Lisbon / '+html(h.name)+'</span></div>'+
    '<div class="property-title"><div>'+stars(h.stars)+'<h1>'+html(h.name)+'</h1><p>Parque Eduardo VII area, Lisbon</p></div>'+
    link("#room-options","See availability","availability_anchor","","primary")+'</div>'+
    '<nav class="property-tabs" aria-label="Hotel sections">'+link("#overview","Overview","property_overview")+link("#room-options","Room options","availability_anchor")+link("#guest-ratings","Guest ratings","ratings_anchor")+'</nav>';
}
function roomTable(s,e){
  return '<section id="room-options" aria-labelledby="rooms-heading"><h2 id="rooms-heading">Room availability</h2><p class="stay-strip">'+dates(s.list.query)+' · '+guestText(s.list.query)+'</p>'+
    '<form id="room-pick" class="availability-grid box" '+cardMark(e.id)+'><div class="room-table-wrap"><table class="room-table"><thead><tr><th>Room type</th><th>Guests</th><th>Total price</th><th>Your selection</th></tr></thead><tbody><tr>'+
    '<td><strong>'+s.room.name+'</strong>'+roomFacts(s.room)+'</td><td>'+unit(s.room.capacity,"adult")+'</td><td><strong>'+money(s.list.total)+'</strong>'+
    '<details><summary data-control="rate_details">Taxes and fees included</summary><p>Includes the room and all taxes for '+nightText(s.list)+'.</p></details></td>'+
    '<td><label class="field">Rooms<select name="quantity" data-control="room_quantity" aria-label="Number of rooms"><option value="0">0</option><option value="1">1</option></select></label></td></tr></tbody></table></div>'+
    '<div class="reserve-panel"><p>'+nightText(s.list)+' · '+guestText(s.list.query)+'</p>'+call("Reserve","reserve_room",'type="submit" disabled')+'</div></form></section>';
}
export function hotelPage(s,e,nav){
  const h=e.hotel, stats=[["Cleanliness",h.cleanliness],["Comfort",h.comfort],["Facilities",h.facilities]];
  return '<div class="frame property" '+cardMark(e.id)+'>'+propertyHeader(s,e,nav)+
    '<section class="property-grid" id="overview"><img class="property-photo" src="'+h.photo+'" width="404" height="303" alt="Standard double room at '+html(h.name)+'"><div class="property-aside box"><div class="eyebrow">Your stay</div><strong>'+dates(s.list.query)+'</strong><p>'+guestText(s.list.query)+'</p><dl><div><dt>Total, taxes included</dt><dd>'+money(s.list.total)+'</dd></div><div><dt>Room</dt><dd>Standard double</dd></div></dl>'+link("#guest-ratings",ratingBadge(h)+" "+rating(h),"ratings_anchor","","rating-link")+'</div></section>'+
    roomTable(s,e)+'<section class="guest-ratings" id="guest-ratings"><h2>Guest ratings</h2><div class="box ratings-panel"><div class="rating-overall">'+ratingBadge(h)+'<strong>'+rating(h)+'</strong></div><div class="rating-components">'+stats.map(([k,v])=>'<div><label>'+k+' <strong>'+v.toFixed(1)+'</strong></label><meter min="0" max="10" value="'+v+'" aria-label="'+k+' score">'+v+'</meter></div>').join("")+'</div></div></section></div>';
}
function checkoutSummary(s,e){
  return '<aside class="booking-aside"><section class="box booking-summary"><img width="404" height="303" src="'+e.hotel.photo+'" alt=""><h2>'+html(e.hotel.name)+'</h2>'+
    '<dl><div><dt>Check-in</dt><dd>'+dateLabel(s.list.query.checkIn)+'</dd></div><div><dt>Check-out</dt><dd>'+dateLabel(s.list.query.checkOut)+'</dd></div><div><dt>Stay</dt><dd>'+nightText(s.list)+'</dd></div><div><dt>Room</dt><dd>'+html(s.room.name)+'</dd></div><div><dt>Guests</dt><dd>'+guestText(s.list.query)+'</dd></div></dl></section>'+
    '<section class="box total-panel"><span>Total price</span><strong>'+money(s.list.total)+'</strong><small>Includes taxes and fees</small></section></aside>';
}
export function checkoutPage(s,e,nav,review){
  const step=review?3:2, back=review?nav("/booking/"+e.id):nav("/hotel/"+e.id)+"#room-options";
  const form=review?'<div class="box guest-form"><h2>Review your booking</h2><p>'+html(e.hotel.name)+' · '+s.room.name+'</p><dl><div><dt>Guest</dt><dd>Alex Morgan</dd></div><div><dt>Email</dt><dd>traveler@example.invalid</dd></div><div><dt>Booking terms</dt><dd>Free cancellation</dd></div></dl><p>This reservation is a simulation. Confirm to finish the booking task.</p>'+call("Confirm simulated booking","confirm_booking",'type="button"')+'</div>':
    '<form class="box guest-form" id="guest-details"><h2>Guest details</h2><p>Use the prefilled test guest details for this stay.</p><div class="field-grid"><label class="field">First name<input readonly value="Alex" autocomplete="off"></label><label class="field">Last name<input readonly value="Morgan" autocomplete="off"></label></div><label class="field">Email address<input readonly value="traveler@example.invalid" autocomplete="off"></label>'+
    call("Review booking","booking_next",'type="submit"')+'</form>';
  return '<div class="frame booking" '+cardMark(e.id)+'><ol class="checkout-steps">'+["Choose a room","Guest details","Confirm"].map((x,i)=>'<li'+(i+1===step?' aria-current="step"':'')+'><span>'+(i+1)+'</span>'+x+'</li>').join("")+'</ol>'+
    '<div class="booking-layout">'+checkoutSummary(s,e)+'<section>'+link(back,review?"Back to guest details":"Back to room selection","booking_back")+'<h1>'+(review?"Confirm your stay":"Enter your details")+'</h1>'+form+'</section></div></div>';
}
export function terminalPage(s){
  const booking=s.booking;
  return '<div class="frame terminal"><section class="box"><p class="kicker">'+(booking?"Simulated reservation":"Rua Stays")+'</p><h1>'+(booking?"Your booking is confirmed":"Search ended")+'</h1>'+
    (booking?'<p>'+html(booking.hotel.name)+' · '+s.room.name+'</p><p>'+dates(s.list.query)+' · '+guestText(s.list.query)+'</p><div class="terminal-total">'+money(s.list.total)+' total</div><p>Reference '+html(s.session.id.slice(-8).toUpperCase())+'</p>':'<p>You ended the search without booking.</p>')+'<p>Thank you for taking part.</p></section></div>';
}
export function errorPage(message,nav){
  return '<div class="frame terminal"><section class="box"><h1>Open your search</h1><p>'+html(message)+'</p>'+link(nav("/search",false),"Return to results","return_to_results","","primary")+'</section></div>';
}
