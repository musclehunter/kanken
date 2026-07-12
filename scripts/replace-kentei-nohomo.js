const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'js', 'grades');
const files = fs.readdirSync(dir).filter(f => f.match(/kentei-(\d+(?:\.5)?)-nohomo-.*\.json$/));

for (const f of files) {
    const grade = f.match(/kentei-(\d+(?:\.5)?)-nohomo-/)[1];
    const src = path.join(dir, f);
    const dst = path.join(dir, `kentei-${grade}.json`);
    fs.copyFileSync(src, dst);
    console.log(`${f} -> kentei-${grade}.json`);
}
