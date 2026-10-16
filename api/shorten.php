<?php
// Self-hosted short links: stores an already-encoded route payload (the same
// string that follows "#r=" in a full share link) under a short id, so a short
// link is just  <site>/?s=<id>  and resolves via route.php. Anonymous, no
// accounts. Same-origin, so no CORS problem (unlike third-party shorteners).
//
// The id is derived from the payload's hash: the same route always gets the
// same id, repeats never grow the store, and nothing is overwritten.

header('Content-Type: application/json');
header('Cache-Control: no-store');

const DATA_DIR = '/var/www/mapmyroute-data';
const MAX_PAYLOAD = 600000;   // bytes
const RATE_LIMIT = 40;        // new links per IP per hour
const KEEP_DAYS = 180;

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only');

$body = file_get_contents('php://input', false, null, 0, MAX_PAYLOAD + 1024);
$data = json_decode($body, true);
$payload = is_array($data) ? ($data['payload'] ?? '') : '';
if (!is_string($payload) || strlen($payload) < 8 || strlen($payload) > MAX_PAYLOAD
    || !preg_match('/^(gz1|raw1)\.[A-Za-z0-9_-]+$/', $payload)) {
    fail(400, 'Invalid route payload');
}

$id = substr(rtrim(strtr(base64_encode(hash('sha256', $payload, true)), '+/', '-_'), '='), 0, 8);
$file = DATA_DIR . "/links/$id.txt";

// Re-sharing an existing route costs nothing and needs no rate limit.
if (!is_file($file)) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0';
    if (in_array($ip, ['127.0.0.1', '::1'], true) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }
    $rateFile = DATA_DIR . '/rate/' . sha1($ip) . '.txt';
    $now = time();
    $stamps = is_file($rateFile) ? array_filter(array_map('intval', file($rateFile, FILE_IGNORE_NEW_LINES)), fn($t) => $t > $now - 3600) : [];
    if (count($stamps) >= RATE_LIMIT) fail(429, 'Too many new links this hour -- try again later');
    $stamps[] = $now;
    file_put_contents($rateFile, implode("\n", $stamps), LOCK_EX);

    if (file_put_contents($file, $payload, LOCK_EX) === false) fail(500, 'Could not store the link');
    // Opportunistic cleanup of old links (1 in 50 requests).
    if (random_int(1, 50) === 1) {
        foreach (glob(DATA_DIR . '/links/*.txt') ?: [] as $f) {
            if (filemtime($f) < $now - KEEP_DAYS * 86400) @unlink($f);
        }
    }
}

echo json_encode(['id' => $id]);
