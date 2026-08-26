/**
 * Reproduce the facepack filename convention exactly:
 *   <first>_<last>_<d>_<m>_<yyyy>.png  — lowercase, spaces -> '_', accents
 *   decomposed and stripped, any remaining non-ASCII dropped ("Søgaard" ->
 *   "sgaard"), apostrophes and periods KEPT, day/month NOT zero-padded.
 * Verified by regenerating every faceId in the shipped DB from name+DOB.
 */
function faceKey(name, y, m, d) {
  const s = name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip combining marks
    .replace(/[^\x00-\x7F]/g, '')                        // drop leftover non-ASCII (ø, ð, ł…)
    .replace(/[\s]+/g, '_')
    .replace(/[^a-z0-9._'-]/g, '');
  return `${s}_${d}_${m}_${y}`;
}
module.exports = { faceKey };
