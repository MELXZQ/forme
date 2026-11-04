import { mkdir, writeFile } from "node:fs/promises";
const root = new URL("../public/images/", import.meta.url);
await mkdir(new URL("products/", root), { recursive: true });
const defs = `<defs>
<linearGradient id="silver" x1="0" y1="0" x2="1" y2=".8"><stop stop-color="#555b5e"/><stop offset=".18" stop-color="#d9dedd"/><stop offset=".34" stop-color="#fafbf5"/><stop offset=".46" stop-color="#9ca4a3"/><stop offset=".62" stop-color="#51595c"/><stop offset=".78" stop-color="#e3e7df"/><stop offset="1" stop-color="#7b8484"/></linearGradient>
<linearGradient id="gold"><stop stop-color="#78674e"/><stop offset=".25" stop-color="#e5ce9e"/><stop offset=".5" stop-color="#ac9165"/><stop offset=".7" stop-color="#f3dfb5"/><stop offset="1" stop-color="#7b6649"/></linearGradient>
<linearGradient id="stone" x2=".8" y2="1"><stop stop-color="#dedbd3"/><stop offset="1" stop-color="#b6afa3"/></linearGradient>
<linearGradient id="face" x1="0" x2="1"><stop stop-color="#9c725a"/><stop offset=".45" stop-color="#d1a88a"/><stop offset="1" stop-color="#aa8066"/></linearGradient>
<linearGradient id="shirt" x2="1" y2="1"><stop stop-color="#3b3f3f"/><stop offset="1" stop-color="#181b1c"/></linearGradient>
<filter id="shadow" x="-60%" y="-60%" width="230%" height="230%"><feDropShadow dx="5" dy="18" stdDeviation="12" flood-color="#35332e" flood-opacity=".2"/></filter>
<filter id="soft"><feGaussianBlur stdDeviation="20"/></filter>
</defs>`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`;
function ring(x = 250, y = 240, s = 1, kind = 0) {
  return `<g transform="translate(${x} ${y}) rotate(-24) scale(${s})" filter="url(#shadow)"><ellipse rx="87" ry="104" fill="none" stroke="url(#silver)" stroke-width="39"/><ellipse rx="65" ry="83" fill="none" stroke="#565f61" stroke-width="3" opacity=".8"/>${kind % 2 === 0 ? '<rect x="-88" y="-124" width="176" height="70" rx="25" fill="url(#silver)"/><rect x="-65" y="-113" width="130" height="44" rx="12" fill="#bfc7c5"/><path d="M-45 -90H45" stroke="#a8afad" stroke-width="1"/>' : '<path d="M-72 -64Q0 -116 72 -64" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="3"/>'}</g>`;
}
function chain(x, y, s = 1, count = 13, angle = -20, metal = "silver") {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${s})" filter="url(#shadow)">${Array.from({ length: count }, (_, i) => `<g transform="translate(${i * 25} ${Math.sin(i * 0.36) * 36}) rotate(${Math.cos(i * 0.36) * 22})"><rect x="-18" y="-28" width="36" height="56" rx="17" fill="none" stroke="url(#${metal})" stroke-width="10"/><path d="M-10 -17v28" stroke="#f5f8ed" opacity=".7" stroke-width="2"/></g>`).join("")}</g>`;
}
function hoop(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) rotate(-25) scale(${s})" filter="url(#shadow)"><ellipse rx="65" ry="85" fill="none" stroke="url(#silver)" stroke-width="19"/><path d="M-45 -60Q0 -90 40 -62" fill="none" stroke="#f5f7f0" stroke-width="3"/><rect x="-7" y="-92" width="20" height="24" rx="4" fill="url(#silver)"/></g>`;
}
function bracelet(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) rotate(-30) scale(${s})" filter="url(#shadow)"><path d="M-59 -55C-160 -17 -110 95 8 95S155 -10 62 -55" fill="none" stroke="url(#silver)" stroke-width="26"/><ellipse cx="-60" cy="-54" rx="13" ry="8" fill="#d6dcd8"/><ellipse cx="62" cy="-54" rx="13" ry="8" fill="#c9ceca"/></g>`;
}
function piercing(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) rotate(-32) scale(${s})" filter="url(#shadow)"><rect x="-9" y="-60" width="18" height="120" rx="8" fill="url(#silver)"/><circle cy="-60" r="26" fill="url(#silver)"/><circle cy="60" r="26" fill="url(#silver)"/></g>`;
}
const slugs = [
  "arc-signet",
  "curb-chain",
  "daily-hoops",
  "link-bracelet",
  "contour-band",
  "fine-chain",
  "bar-stud",
  "orbit-piercing",
  "ridge-ring",
  "box-chain",
  "mini-hoop",
  "cuff-bracelet",
  "double-band",
  "pendant-chain",
  "chain-bracelet",
  "point-piercing",
];
for (let i = 0; i < slugs.length; i++) {
  const kind = [
    "ring",
    "chain",
    "hoop",
    "bracelet",
    "ring",
    "chain",
    "piercing",
    "piercing",
    "ring",
    "chain",
    "hoop",
    "bracelet",
    "ring",
    "chain",
    "bracelet",
    "piercing",
  ][i];
  let jewel = "";
  if (kind === "ring") jewel = ring(250, 260, 0.9, i);
  if (kind === "hoop") jewel = hoop(205, 245, 0.85) + hoop(302, 295, 0.85);
  if (kind === "bracelet")
    jewel =
      i === 3 || i === 14
        ? chain(65, 260, 0.96, 15, -8)
        : bracelet(250, 250, 1.1);
  if (kind === "chain")
    jewel = `<g transform="rotate(-18 250 250)"><ellipse cx="250" cy="230" rx="110" ry="149" fill="none" stroke="url(#silver)" stroke-width="${i === 5 ? 8 : 14}"/>${Array.from(
      { length: 38 },
      (_, n) => {
        const a = (n * Math.PI * 2) / 38;
        return `<ellipse cx="${250 + 110 * Math.cos(a)}" cy="${230 + 149 * Math.sin(a)}" rx="8" ry="12" transform="rotate(${(n * 360) / 38} ${250 + 110 * Math.cos(a)} ${230 + 149 * Math.sin(a)})" fill="none" stroke="url(#silver)" stroke-width="4"/>`;
      },
    ).join(
      "",
    )}${i === 13 ? '<rect x="231" y="360" width="38" height="60" rx="8" fill="url(#silver)"/>' : ""}</g>`;
  if (kind === "piercing") jewel = piercing(250, 255, i === 6 ? 0.75 : 0.9);
  await writeFile(
    new URL(`products/${slugs[i]}.svg`, root),
    svg(
      500,
      500,
      `<rect width="500" height="500" fill="${i % 3 === 0 ? "#e6e3dc" : i % 3 === 1 ? "#e8e6e1" : "#e0ded7"}"/><ellipse cx="265" cy="393" rx="115" ry="17" fill="#625f55" opacity=".10" filter="url(#soft)"/>${jewel}`,
    ),
  );
}
const floor = `<rect width="1000" height="650" fill="#d8d3c8"/><path d="M0 480L1000 220V650H0Z" fill="#cbc5b9"/><path d="M630 0L1000 0V420L870 450Z" fill="#eeeae0" opacity=".35"/>`;
await writeFile(
  new URL("hero-chain.svg", root),
  svg(
    1000,
    650,
    `${floor}<path d="M360 325L840 280L925 390L445 443Z" fill="#afa79b"/><path d="M360 325L445 443V520L360 402Z" fill="#c3bbae"/><path d="M445 443L925 390V467L445 520Z" fill="url(#stone)"/>${chain(100, 205, 1.45, 20, 8)}${ring(700, 405, 1.05, 0)}<text x="950" y="602" text-anchor="end" font-family="sans-serif" font-size="12" letter-spacing="4" fill="#736e64">FORM / OBJECT 001</text>`,
  ),
);
await writeFile(
  new URL("hero-rings.svg", root),
  svg(
    1000,
    650,
    `${floor}<rect x="190" y="245" width="430" height="290" fill="url(#stone)"/><path d="M190 245L315 170H745L620 245Z" fill="#e7e1d6"/><path d="M620 245L745 170V460L620 535Z" fill="#b5ac9e"/>${ring(410, 280, 1.35, 0)}${ring(720, 450, 0.92, 1)}`,
  ),
);
await writeFile(
  new URL("hero-links.svg", root),
  svg(
    1000,
    650,
    `${floor}<circle cx="580" cy="350" r="210" fill="#bd937b"/>${chain(210, 330, 1.5, 17, -12)}${hoop(660, 330, 1.3)}${hoop(790, 390, 0.95)}`,
  ),
);
await writeFile(
  new URL("collection-form.svg", root),
  svg(
    900,
    620,
    `<rect width="900" height="620" fill="#dcd9d1"/><path d="M0 475L900 310V620H0Z" fill="#c8c3b7"/><rect x="140" y="210" width="395" height="300" fill="url(#stone)"/><path d="M140 210L270 150H665L535 210Z" fill="#eee9df"/>${ring(365, 260, 1.15, 0)}${bracelet(650, 400, 1.25)}`,
  ),
);
await writeFile(
  new URL("collection-linked.svg", root),
  svg(
    900,
    620,
    `<rect width="900" height="620" fill="#b98e77"/><path d="M0 450L900 285V620H0Z" fill="#ac7e67"/><circle cx="520" cy="300" r="205" fill="#cfa98f"/>${chain(120, 285, 1.35, 18, 8)}${hoop(580, 365, 1.25)}${hoop(710, 410, 0.95)}`,
  ),
);
function model(mobile = false) {
  // Separate mobile composition: wider shoulders and larger face in a tighter canvas.
  const body = `<ellipse cx="500" cy="730" rx="190" ry="20" fill="#000" opacity=".4" filter="url(#soft)"/>
  <path d="M457 243L450 315Q490 355 547 314L538 241Z" fill="url(#face)"/>
  <path d="M449 294L362 319Q321 336 304 402L270 659L345 700L384 505L378 760H624L620 510L655 703L733 660L695 395Q680 335 639 319L546 294Q503 340 449 294Z" fill="url(#shirt)"/>
  <path d="M449 299L476 341L497 384L520 338L546 299Q506 319 449 299Z" fill="#b98e72"/>
  <path d="M428 159Q426 85 500 79Q566 78 575 149L562 238Q537 281 500 286Q456 275 437 234Z" fill="url(#face)"/>
  <path d="M432 175Q407 91 455 66Q491 43 541 66Q594 83 577 169L555 140L550 110Q506 139 453 115L446 171Z" fill="#302d29"/>
  <path d="M442 96Q477 62 548 82" fill="none" stroke="#51453a" stroke-width="10" opacity=".5"/>
  <ellipse cx="434" cy="190" rx="13" ry="26" fill="#b78b71"/><ellipse cx="570" cy="190" rx="12" ry="26" fill="#aa7d64"/>
  <path d="M461 178L484 175M520 175L543 178" stroke="#584333" stroke-width="5" stroke-linecap="round"/>
  <path d="M464 189L482 188M521 188L539 189" stroke="#352f28" stroke-width="3"/>
  <path d="M501 188L495 220L507 222" fill="none" stroke="#a27258" stroke-width="3"/>
  <path d="M480 245Q500 253 522 241" fill="none" stroke="#7a5442" stroke-width="3"/>
  <path d="M449 229Q459 276 501 282Q539 272 553 232Q531 253 518 259L482 258Z" fill="#503a2d" opacity=".27"/>
  <path d="M355 512L322 625Q316 652 355 662L512 563L487 524L375 575Z" fill="url(#face)"/>
  <path d="M657 510L691 627Q694 654 654 661L487 576L511 533L635 577Z" fill="url(#face)"/>
  <path d="M478 526Q480 511 498 497L531 478Q540 473 545 481L516 509L556 493Q565 492 565 500L528 524L569 512Q578 513 574 522L535 542L564 534Q576 537 568 547L520 572Q504 580 486 566Z" fill="url(#face)"/>
  <path d="M505 536Q484 527 472 518L442 495Q431 491 430 500L452 523L416 509Q407 508 409 518L441 539L407 530Q396 534 403 542L438 558L416 553Q404 556 416 566L468 587Q489 594 507 575Z" fill="url(#face)"/>
  <path d="M455 313Q456 384 499 416Q546 380 545 313" fill="none" stroke="#979f9b" stroke-width="4"/>
  <path d="M455 313Q456 384 499 416Q546 380 545 313" fill="none" stroke="#f4f0dc" stroke-width="1" stroke-dasharray="2 5"/><rect x="491" y="412" width="16" height="25" rx="4" fill="url(#silver)"/>
  <ellipse cx="435" cy="211" rx="10" ry="14" fill="none" stroke="url(#silver)" stroke-width="5"/><circle cx="511" cy="214" r="3.5" fill="#e8e7dc"/>
  <path d="M638 575L628 600" stroke="url(#silver)" stroke-width="12"/><path d="M443 537L434 551" stroke="url(#silver)" stroke-width="9"/><path d="M455 546L448 560" stroke="url(#silver)" stroke-width="6"/>
  <path d="M382 400L361 487M619 398L645 484M401 641L393 752M600 641L611 752" stroke="#535957" stroke-width="2" opacity=".5"/>`;
  return svg(
    mobile ? 500 : 1000,
    760,
    mobile ? `<g transform="translate(-250 0)">${body}</g>` : body,
  );
}
await writeFile(new URL("model-desktop.svg", root), model());
await writeFile(new URL("model-mobile.svg", root), model(true));
await writeFile(
  new URL("fallback.svg", root),
  svg(
    500,
    500,
    `<rect width="500" height="500" fill="#e8e6e1"/>${ring(250, 230, 0.65, 1)}<text x="250" y="410" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#555">Image coming soon</text>`,
  ),
);
await writeFile(
  new URL("../icon.svg", root),
  svg(
    64,
    64,
    '<rect width="64" height="64" rx="4" fill="#292b2c"/><path d="M19 48V16h29v6H26v9h19v6H26v11Z" fill="#f8f7f4"/>',
  ),
);
console.log("Generated 25 local SVG assets.");
