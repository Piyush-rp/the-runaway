// The gang boss on the radio. He needles the player all game long: on a timer, and whenever something happens that he can
// make fun of (a knock-out, a missed shot, a teleport, a long walk, a milestone). Cheeky villain banter that stays in the
// fiction: it is about the hero's skills and choices, never about real people.
const SPEAKER = 'THE BROKER';

const LINES = {
  ambient: [
    'Still on foot? My grandmother hovers faster than you.',
    'Tick tock, hero. Every second you waste is one I enjoy.',
    'Nice jacket. Shame about the ending.',
    'One kid. All this effort. You must be really bad at hobbies.',
    "I'm not even trying yet. Don't get cocky.",
    "Running errands for a kid who isn't even yours. Adorable.",
    'Careful out there. Wouldn\'t want you tripping over your own ego.',
    'Is that your best walk? Because it looks like your worst.',
    'My guys placed bets on how long you last. I took the short end. Please don\'t disappoint me.',
    'You know the city is watching, right? Smile. Or don\'t. The footage is funnier that way.',
    'Heroes always take the long way. It never ends well for them.',
    'Quiet out there. Too quiet. Do you miss me?',
  ],
  knockout: [
    'Down already? Embarrassing. Get up, it is no fun when you quit.',
    'Again? Are you doing this on purpose?',
    'That was a nap, right? Please say it was a nap.',
    'Another one for the highlight reel. Not the good reel.',
  ],
  lowHp: [
    "You're bleeding. It suits you.",
    'Health bar looking lonely. Maybe sit this one out?',
    'Careful, that red bar is not a decoration.',
  ],
  childHurt: [
    "Careful with the kid. Oh wait, I don't care.",
    'Hope the little one has insurance.',
  ],
  miss: [
    'Were you aiming at the sky? My guys are over here.',
    'Missed. Again. Did the gun come with instructions?',
    'My riders are laughing. It is a lot of laughing.',
  ],
  teleport: [
    'Blinking around like a coward. Stand still and fight!',
    'Teleporting again? Cheating is just fast losing.',
    'Poof. Gone. Just like your plan.',
  ],
  hijack: [
    'Stealing boards now? Classic you.',
    'That board had an owner, you know. He is furious. I am delighted.',
  ],
  enter: [
    'Welcome to my side of town. Wipe your feet.',
    'You crossed the line. Bold. Foolish, but bold.',
  ],
  leave: [
    'Running away? Of course you are.',
    'Leaving so soon? We were just getting to the fun part.',
  ],
  decrypt: [
    'Decrypting? Cute. I changed the password.',
    'Oh, you found a terminal. Good for you. Truly.',
    'Slow typing. Slower thinking.',
  ],
  release: [
    'Congratulations, you opened a door. Want a medal?',
    'The kid is out. You think that is the hard part? Adorable.',
  ],
  riders: [
    "Meet my friends. They'd like a word. Several, actually.",
    'Sky boards, hero. Roofs will not save you this time.',
  ],
  hospital: [
    "A doctor? She'll be fine. It is you I am worried about.",
    'Waiting rooms are boring. I will send company.',
  ],
  food: [
    'Snack time in the middle of a manhunt. Priorities.',
    'Eat up, kid. Last meal jokes are free today.',
  ],
  parents: [
    'Aww, a family reunion. I will send flowers.',
    'Say goodbye to them. Properly.',
  ],
  exit: [
    'Almost out... almost. You really think it ends at the gate?',
    'The south gate? Predictable. I like predictable.',
  ],
  idle: [
    'Taking a nap? I can wait. I am very patient. I am also very rich.',
    'You have been standing there a while. Lost? Scared? Both?',
  ],
};

export class Taunter {
  constructor(radio, sfx) {
    this.radio = radio; this.sfx = sfx; this.onSay = null;
    this.cool = 12;        // seconds until the next taunt may play
    this.next = 20;        // seconds until the next ambient taunt
    this.recent = [];      // last few lines, so he does not repeat himself
    this.idleT = 0; this.lastPos = null;
  }

  pick(cat) {
    const list = LINES[cat]; if (!list) return null;
    const fresh = list.filter((l) => !this.recent.includes(l));
    const line = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
    this.recent.push(line); if (this.recent.length > 10) this.recent.shift();
    return line;
  }

  // chance < 1 keeps repeating events (teleports, hijacks) from turning into spam; force bypasses the cooldown
  say(cat, { chance = 1, force = false } = {}) {
    if (!force && this.cool > 0) return false;
    if (Math.random() > chance) return false;
    const line = this.pick(cat); if (!line) return false;
    this.radio.push(SPEAKER, line, 'taunt', 1);
    this.onSay?.(cat); // the buddy may answer
    this.cool = 7 + Math.random() * 4;
    this.next = 28 + Math.random() * 20;
    return true;
  }

  // call every frame while playing. info: { x, z, hostile }
  update(dt, info) {
    this.cool -= dt; this.next -= dt;
    // standing around: needle them about it
    if (this.lastPos && Math.hypot(info.x - this.lastPos.x, info.z - this.lastPos.z) < 1.2) this.idleT += dt; else { this.idleT = 0; this.lastPos = { x: info.x, z: info.z }; }
    if (this.idleT > 14) { this.idleT = 0; this.say('idle'); }
    if (this.next <= 0) this.say('ambient', { force: this.cool <= 0 });
  }
}
