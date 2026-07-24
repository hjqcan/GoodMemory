const raw = await Bun.stdin.text();

process.stdout.write(`${JSON.stringify({
  env: process.env,
  pid: process.pid,
  raw,
})}\n`);
