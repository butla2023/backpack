// GET /api/auth/logout — clears the Backpack session cookie and returns home.
export default function handler(req, res) {
  res.setHeader(
    'Set-Cookie',
    'backpack_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );
  res.writeHead(302, { Location: '/' });
  res.end();
}
