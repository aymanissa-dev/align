export async function deliverMail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from) return false
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      console.error(JSON.stringify({ msg: 'mail-failed', status: response.status }))
      return false
    }
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}
