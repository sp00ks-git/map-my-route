<?php
// Resolves a short link id (see shorten.php) back to its route payload.

header('Content-Type: application/json');

$id = $_GET['id'] ?? '';
if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{6,16}$/', $id)) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad link id']);
    exit;
}
$file = "/var/www/mapmyroute-data/links/$id.txt";
if (!is_file($file)) {
    http_response_code(404);
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'This short link has expired or never existed']);
    exit;
}
touch($file); // keep links that are still being used
header('Cache-Control: public, max-age=3600');
echo json_encode(['payload' => file_get_contents($file)]);
