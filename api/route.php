<?php
// Resolves a short link id (see shorten.php) back to its route payload.

header('Content-Type: application/json');

$id = $_GET['id'] ?? '';
if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{6,16}$/', $id)) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad link id']);
    exit;
}
$dir = '/var/www/mapmyroute-data/links';
$file = "$dir/$id.txt";

// Retyped links get mangled: auto-capitalised first letter, capital I vs
// lowercase l vs 1, O vs 0. If the exact id isn't found, accept a case- and
// look-alike-insensitive match -- but only when it is unambiguous.
function fold_id(string $s): string {
    return strtr(strtolower($s), ['i' => 'l', '1' => 'l', 'o' => '0']);
}
if (!is_file($file)) {
    $want = fold_id($id);
    $matches = [];
    foreach (glob("$dir/*.txt") ?: [] as $f) {
        if (fold_id(basename($f, '.txt')) === $want) $matches[] = $f;
    }
    if (count($matches) === 1) $file = $matches[0];
}
if (!is_file($file)) {
    http_response_code(404);
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'This short link has expired or never existed']);
    exit;
}
touch($file); // keep links that are still being used
header('Cache-Control: public, max-age=3600');
$payload = file_get_contents($file);
$out = ['payload' => $payload];
// Also hand back the decompressed route JSON: browsers without
// DecompressionStream (older phones/WebViews) can't gunzip it themselves.
if (strpos($payload, 'gz1.') === 0) {
    $bin = base64_decode(strtr(substr($payload, 4), '-_', '+/'), true);
    $json = $bin === false ? false : @gzdecode($bin);
    if ($json !== false && strlen($json) < 4000000) $out['json'] = $json;
}
echo json_encode($out);
