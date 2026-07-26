import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

export interface DirectoryIdentity {
  dev: number;
  ino: number;
  mode: number;
}

export async function directoryIdentity(
  path: string,
): Promise<DirectoryIdentity> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`C6 expected a regular directory ${path}`);
  }
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}

export async function assertDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await directoryIdentity(path);
  if (
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mode !== expected.mode ||
    await realpath(path) !== path
  ) {
    throw new Error(`C6 ${label} drifted`);
  }
}

export async function canonicalExistingDirectory(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    throw new Error(`C6 ${label} does not exist`);
  }
  const stat = await lstat(absolute);
  if (
    canonical !== absolute ||
    stat.isSymbolicLink() ||
    !stat.isDirectory()
  ) {
    throw new Error(`C6 ${label} rejects symlink path components`);
  }
  return canonical;
}

export async function canonicalExistingFile(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    throw new Error(`C6 ${label} does not exist`);
  }
  const stat = await lstat(absolute);
  if (
    canonical !== absolute ||
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    throw new Error(`C6 ${label} rejects symlink path components`);
  }
  return canonical;
}

export async function canonicalNewFilePath(
  path: string,
  label: string,
): Promise<string> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (
    await realpath(parent) !== parent ||
    basename(absolute).length === 0 ||
    await pathExists(absolute)
  ) {
    throw new Error(
      `C6 ${label} requires a canonical parent and absent output`,
    );
  }
  return absolute;
}

export interface OutputReservation {
  handle: Awaited<ReturnType<typeof open>>;
  lockIdentity: DirectoryIdentity;
  lockPath: string;
  outputIdentity: DirectoryIdentity;
  outputRoot: string;
  parent: string;
}

export async function reserveOutputRoot(path: string): Promise<OutputReservation> {
  const outputRoot = resolve(path);
  const parent = dirname(outputRoot);
  if (
    await realpath(parent) !== parent ||
    basename(outputRoot).length === 0
  ) {
    throw new Error(
      "C6 source build output root requires a canonical existing parent",
    );
  }
  const lockPath = `${outputRoot}.materialize.lock`;
  let handle: Awaited<ReturnType<typeof open>>;
  let outputCreated = false;
  let outputIdentity: DirectoryIdentity | undefined;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error("C6 source build output root is already locked");
  }
  try {
    await mkdir(outputRoot, { mode: 0o700 });
    outputCreated = true;
    outputIdentity = await directoryIdentity(outputRoot);
    if (await realpath(outputRoot) !== outputRoot) {
      throw new Error(
        "C6 source build output root rejects symlink components",
      );
    }
    const lockStat = await handle.stat();
    return {
      handle,
      lockIdentity: {
        dev: lockStat.dev,
        ino: lockStat.ino,
        mode: lockStat.mode,
      },
      lockPath,
      outputIdentity,
      outputRoot,
      parent,
    };
  } catch (error) {
    await handle.close();
    await rm(lockPath, { force: true });
    if (outputCreated && outputIdentity !== undefined) {
      await quarantineAndRemoveDirectory(
        outputRoot,
        parent,
        outputIdentity,
        "source build output root during reservation cleanup",
      );
      throw error;
    }
    if (await pathExists(outputRoot)) {
      throw new Error("C6 source build output root already exists");
    }
    throw error;
  }
}

export async function assertOutputReservation(
  reservation: OutputReservation,
  label: string,
): Promise<void> {
  await assertDirectoryIdentity(
    reservation.outputRoot,
    reservation.outputIdentity,
    `source build output root ${label}`,
  );
  await assertReservationLock(reservation, label);
}

export async function publishStagingRoot(
  stagingRoot: string,
  reservation: OutputReservation,
  beforeFirstWrite: () => Promise<void> | void,
): Promise<void> {
  const expectedEntries = ["runs", "source"];
  const actualEntries = (await readdir(stagingRoot))
    .sort(compareUtf8);
  if (!sameJson(actualEntries, expectedEntries)) {
    throw new Error(
      "C6 source build staging root contains an unexpected artifact",
    );
  }
  let firstWritePending = true;
  for (const entry of expectedEntries) {
    await publishStagingEntryExclusive({
      beforeWrite: async () => {
        if (firstWritePending) {
          firstWritePending = false;
          await beforeFirstWrite();
        }
      },
      destination: join(reservation.outputRoot, entry),
      reservation,
      source: join(stagingRoot, entry),
    });
  }
  await rmdir(stagingRoot);
}

async function publishStagingEntryExclusive(input: {
  beforeWrite: () => Promise<void>;
  destination: string;
  reservation: OutputReservation;
  source: string;
}): Promise<void> {
  await assertOutputReservation(
    input.reservation,
    "during artifact publication",
  );
  const sourceStat = await lstat(input.source);
  await input.beforeWrite();
  if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
    try {
      await mkdir(input.destination, {
        mode: sourceStat.mode & 0o777,
      });
    } catch (error) {
      throwOutputArtifactCollision(error);
    }
    for (
      const entry of (await readdir(input.source))
        .sort(compareUtf8)
    ) {
      await publishStagingEntryExclusive({
        beforeWrite: input.beforeWrite,
        destination: join(input.destination, entry),
        reservation: input.reservation,
        source: join(input.source, entry),
      });
    }
    await rmdir(input.source);
    await assertOutputReservation(
      input.reservation,
      "after directory publication",
    );
    return;
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(
      "C6 source build staging root contains a non-regular artifact",
    );
  }
  try {
    await link(input.source, input.destination);
  } catch (error) {
    throwOutputArtifactCollision(error);
  }
  const publishedStat = await lstat(input.destination);
  if (
    !publishedStat.isFile() ||
    publishedStat.isSymbolicLink() ||
    publishedStat.dev !== sourceStat.dev ||
    publishedStat.ino !== sourceStat.ino
  ) {
    throw new Error("C6 source build published artifact identity drifted");
  }
  await unlink(input.source);
  await assertOutputReservation(
    input.reservation,
    "after file publication",
  );
}

function throwOutputArtifactCollision(error: unknown): never {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "EEXIST"
  ) {
    throw new Error(
      "C6 source build refuses to replace an output artifact",
    );
  }
  throw error;
}

export async function quarantineAndRemoveOutputReservation(
  reservation: OutputReservation,
): Promise<void> {
  await assertReservationLock(
    reservation,
    "before output quarantine cleanup",
  );
  await quarantineAndRemoveDirectory(
    reservation.outputRoot,
    reservation.parent,
    reservation.outputIdentity,
    "source build output reservation",
  );
}

async function quarantineAndRemoveDirectory(
  path: string,
  parent: string,
  expected: DirectoryIdentity,
  label: string,
): Promise<void> {
  const quarantineRoot = await mkdtemp(join(
    parent,
    `.${basename(path)}.cleanup-`,
  ));
  const quarantinedPath = join(quarantineRoot, "owned-output");
  let moved = false;
  try {
    await rename(path, quarantinedPath);
    moved = true;
    await assertDirectoryIdentity(
      quarantinedPath,
      expected,
      `${label} after atomic quarantine`,
    );
    await rm(quarantinedPath, { recursive: true });
    await rmdir(quarantineRoot);
  } catch (error) {
    if (!moved) {
      await rmdir(quarantineRoot);
    }
    throw error;
  }
}

async function assertReservationLock(
  reservation: OutputReservation,
  label: string,
): Promise<void> {
  const [opened, pathStat, canonical] = await Promise.all([
    reservation.handle.stat(),
    lstat(reservation.lockPath),
    realpath(reservation.lockPath),
  ]);
  const expected = reservation.lockIdentity;
  if (
    !opened.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    canonical !== reservation.lockPath ||
    opened.dev !== expected.dev ||
    opened.ino !== expected.ino ||
    opened.mode !== expected.mode ||
    pathStat.dev !== expected.dev ||
    pathStat.ino !== expected.ino ||
    pathStat.mode !== expected.mode
  ) {
    throw new Error(`C6 source build reservation lock drifted ${label}`);
  }
}

export async function releaseOutputReservation(
  reservation: OutputReservation,
): Promise<void> {
  try {
    await assertReservationLock(reservation, "before release");
  } catch (error) {
    await reservation.handle.close();
    throw error;
  }
  await reservation.handle.close();
  await unlink(reservation.lockPath);
}

export async function writeAtomicExclusive(
  path: string,
  bytes: string | Uint8Array,
  mode: number,
): Promise<void> {
  const finalPath = await canonicalNewFilePath(path, "exclusive artifact");
  const temporaryPath = `${finalPath}.tmp-${randomUUID()}`;
  let temporaryCreated = false;
  let linked = false;
  try {
    const handle = await open(temporaryPath, "wx", mode);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, finalPath);
    linked = true;
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!linked) {
          throw error;
        }
      }
    }
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
