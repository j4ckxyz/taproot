// Fills a Taproot server with a few demo projects that show off most features.
//
//   TAPROOT_URL=http://localhost:8787 TAPROOT_EMAIL=you@example.com TAPROOT_PASSWORD=… npm run seed:demo
//
// On a brand-new server it creates the admin account with those details first.
// Due dates are relative to today, so deadline highlights always have something to show.

const BASE = (process.env.TAPROOT_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const EMAIL = process.env.TAPROOT_EMAIL ?? 'demo@taproot.local';
const PASSWORD = process.env.TAPROOT_PASSWORD ?? 'demo-password';
const NAME = process.env.TAPROOT_NAME ?? 'Alex';

let cookie = '';
async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-taproot-client': '1', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Turns a nested outline into the flat node list the import endpoint takes. */
function doc(project, root) {
  const nodes = [];
  let n = 0;
  const walk = (item, parentId) => {
    const id = `demo${String(++n).padStart(6, '0')}`;
    const { children = [], ...fields } = item;
    nodes.push({ tags: [], meta: {}, notes: '', ...fields, id, parentId, sort: n });
    for (const c of children) walk(c, id);
  };
  walk(root, null);
  return { format: 'taproot-project', version: 1, project, nodes };
}

const PROJECTS = [
  doc(
    { name: 'Launch Taproot 1.0', icon: '🚀', color: 'violet', description: 'Ship the first public release: design polish, docs, and a launch everyone can try the same day.' },
    {
      title: 'Launch Taproot 1.0',
      childLayout: 'row',
      children: [
        {
          title: 'Design',
          color: 'blue',
          children: [
            { title: 'Pick a name and logo', done: true, tags: ['brand'] },
            { title: 'Modern card styles', done: true },
            { title: 'Dark mode pass', dueDate: day(1), tags: ['ui'] },
            { title: 'Design review', shape: 'diamond', dueDate: day(3) },
          ],
        },
        {
          title: 'Build',
          color: 'green',
          dueDate: day(-2),
          children: [
            { title: 'Spring motion engine', done: true, notes: 'Cards spring into place and nudge their neighbours.' },
            { title: 'Right-click menu', done: true },
            { title: 'Live presence for agents', notes: 'Cursor + pulse when an agent edits.', meta: { owner: 'Alex', estimate: '2d' } },
            { title: 'Beta ready', shape: 'diamond', dueDate: day(6) },
          ],
        },
        {
          title: 'Docs',
          color: 'teal',
          children: [
            { title: 'README with screenshots', dueDate: day(0) },
            { title: 'Agent setup guide', shape: 'ellipse', tags: ['mcp'] },
            { title: 'Update guide', shape: 'ellipse', done: true },
          ],
        },
        {
          title: 'Launch',
          color: 'pink',
          childLayout: 'column',
          children: [
            { title: 'Write the announcement', dueDate: day(8) },
            { title: 'Post a demo video', tags: ['social'] },
            {
              title: 'Collect feedback',
              collapsed: true,
              children: [{ title: 'GitHub issues triage' }, { title: 'Reply to early users' }, { title: 'Plan 1.1' }],
            },
          ],
        },
      ],
    },
  ),
  doc(
    { name: 'Geography NEA', icon: '📚', color: 'green', description: 'Independent investigation: how does footfall change along the high street?' },
    {
      title: 'Geography NEA',
      childLayout: 'row',
      children: [
        {
          title: 'Research',
          color: 'teal',
          children: [
            { title: 'Pick a question', done: true },
            { title: 'Literature review', done: true, notes: 'Burgess model, bid-rent theory, council footfall reports.' },
            { title: 'Risk assessment', done: true },
          ],
        },
        {
          title: 'Fieldwork',
          color: 'orange',
          children: [
            { title: 'Pedestrian counts', dueDate: day(-1), tags: ['data'] },
            { title: 'Questionnaire (30 people)', dueDate: day(2) },
            { title: 'Environmental quality survey', shape: 'ellipse' },
          ],
        },
        {
          title: 'Analysis',
          color: 'blue',
          children: [{ title: 'Chart the counts' }, { title: 'Spearman’s rank', shape: 'ellipse' }, { title: 'Map the sites', shape: 'ellipse' }],
        },
        { title: 'Hand in', shape: 'diamond', color: 'red', dueDate: day(21) },
      ],
    },
  ),
  doc(
    { name: 'Grow the newsletter', icon: '🌱', color: 'orange', description: 'From 400 to 2,000 subscribers this quarter.' },
    {
      title: 'Grow the newsletter',
      childLayout: 'row',
      children: [
        { title: 'Better sign-up page', done: true, children: [{ title: 'Rewrite the pitch', done: true }, { title: 'Add a sample issue', done: true }] },
        { title: 'Weekly posting rhythm', children: [{ title: 'Draft queue of 6 issues', dueDate: day(4) }, { title: 'Schedule social posts' }] },
        { title: 'Partnerships', children: [{ title: 'Swap shout-outs with 3 newsletters' }, { title: 'Guest post', dueDate: day(12) }] },
      ],
    },
  ),
  doc(
    { name: 'Move house', icon: '🏡', color: 'teal', description: 'Moving on the 30th.' },
    {
      title: 'Move house',
      childLayout: 'row',
      children: [
        { title: 'Book the van', done: true },
        { title: 'Pack', children: [{ title: 'Books', done: true }, { title: 'Kitchen' }, { title: 'Wardrobe' }] },
        { title: 'Change address', children: [{ title: 'Bank' }, { title: 'GP' }, { title: 'Council tax', dueDate: day(5) }] },
        { title: 'Moving day', shape: 'diamond', dueDate: day(13) },
      ],
    },
  ),
];

const status = await call('GET', '/api/v1/auth/status');
if (status.needsSetup) await call('POST', '/api/v1/auth/setup', { email: EMAIL, name: NAME, password: PASSWORD });
else await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD });

for (const d of PROJECTS) {
  const r = await call('POST', '/api/v1/projects/import?format=json', JSON.stringify(d));
  console.log(`${d.project.icon} ${d.project.name}  ${BASE}/p/${r.project.id}`);
}
