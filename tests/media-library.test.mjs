import assert from "node:assert/strict";
import test from "node:test";
import { indexMediaFiles, filterMedia, nextMediaIndex, createMediaUrlCache } from "../src/scripts/media-library.js";

const file = (path, lastModified = 0, type = "") => ({ name: path.split("/").pop(), webkitRelativePath: path, size: 100, lastModified, type });

test("folder indexing keeps media, counts descendants, and skips unrelated or hidden files", () => {
  const result = indexMediaFiles([
    file("Photos/one.JPG"), file("Photos/Trip/video.MOV"), file("Photos/Trip/Night/two.heic"),
    file("Photos/notes.pdf"), file("Photos/.cache/hidden.jpg"), file("Photos/__MACOSX/fake.jpg"),
    file("Photos/music.ogg", 0, "audio/ogg"), { ...file("Photos/empty.png"), size: 0 },
  ]);
  assert.deepEqual(result.items.map((item) => item.kind), ["image", "video", "image"]);
  assert.equal(result.ignored, 5);
  assert.deepEqual(result.folders, [["Photos", 3], ["Photos/Trip", 2], ["Photos/Trip/Night", 1]]);
});

test("the indexing limit counts excess media separately from unrelated files", () => {
  const result = indexMediaFiles([file("1.jpg"), file("2.mp4"), file("3.png"), file("notes.txt")], 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.overflow, 1);
  assert.equal(result.ignored, 1);
});

test("folder, type, and case-insensitive search filters combine without matching sibling prefixes", () => {
  const { items } = indexMediaFiles([file("Album/Trip/2.jpg"), file("Album/Trip/Night/3.mp4"), file("Album/Trip2/4.jpg")]);
  assert.equal(filterMedia(items, { folder: "Album/Trip" }).length, 2);
  assert.equal(filterMedia(items, { folder: "Album/Trip", kind: "video", search: "NIGHT" })[0].name, "3.mp4");
  assert.equal(filterMedia(items, { search: "not present" }).length, 0);
});

test("sorting is natural by name or by file-modified date and does not mutate the library", () => {
  const { items } = indexMediaFiles([file("img10.jpg", 20), file("img2.jpg", 10), file("img1.jpg", 30)]);
  assert.deepEqual(filterMedia(items).map((item) => item.name), ["img1.jpg", "img2.jpg", "img10.jpg"]);
  assert.deepEqual(filterMedia(items, { sort: "newest" }).map((item) => item.modified), [30, 20, 10]);
  assert.deepEqual(filterMedia(items, { sort: "oldest" }).map((item) => item.modified), [10, 20, 30]);
  assert.equal(items[0].name, "img10.jpg");
});

test("viewer navigation wraps and image slideshows skip videos", () => {
  const items = [{ kind: "image" }, { kind: "video" }, { kind: "image" }];
  assert.equal(nextMediaIndex(items, 2, 1), 0);
  assert.equal(nextMediaIndex(items, 0, -1), 2);
  assert.equal(nextMediaIndex(items, 0, 1, true), 2);
  assert.equal(nextMediaIndex([{ kind: "video" }], 0, 1, true), -1);
  assert.equal(nextMediaIndex([], 0, 1), -1);
});

test("thumbnail cache evicts least-recently-used URLs and revokes every remaining URL on clear", () => {
  const revoked = [];
  const cache = createMediaUrlCache(2, (url) => revoked.push(url));
  cache.set("a", "blob:a"); cache.set("b", "blob:b");
  assert.equal(cache.get("a"), "blob:a");
  cache.set("c", "blob:c");
  assert.deepEqual(revoked, ["blob:b"]);
  assert.equal(cache.get("b"), null);
  cache.set("a", "blob:a2");
  assert.deepEqual(revoked, ["blob:b", "blob:a"]);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.deepEqual(new Set(revoked), new Set(["blob:a", "blob:b", "blob:c", "blob:a2"]));
});
