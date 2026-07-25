// permissions.js — pure, no dependencies. Loaded as a plain <script> in
// map.html (defines the global `isOwner`) and required directly from Node
// for the unit test below.
function isOwner(userId, folderOwnerId) {
  return !!userId && !!folderOwnerId && userId === folderOwnerId;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { isOwner };
}
