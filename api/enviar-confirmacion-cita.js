import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id_cita, email_cliente } = req.body;

  if (!id_cita) {
    return res.status(400).json({ error: 'id_cita es requerido' });
  }

  if (!email_cliente) {
    return res.status(400).json({ error: 'email_cliente es requerido' });
  }

  try {
    // 1. Llamar RPC para generar token y obtener datos para email
    const emailDataResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/generar_token_confirmacion`,
      {
        method: 'POST',
        headers: {
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_id_cita: id_cita }),
      }
    );

    if (!emailDataResponse.ok) {
      throw new Error(`Supabase RPC failed: ${emailDataResponse.statusText}`);
    }

    const emailDataRows = await emailDataResponse.json();
    if (!emailDataRows || emailDataRows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const {
      token,
      url_confirmacion,
      fecha_expiracion,
      nombre_cliente,
      fecha_cita,
      hora_cita,
      barbero_nombre,
      servicio_nombre,
    } = emailDataRows[0];

    // 1.5. Insertar token en BD directamente
    await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/token_confirmacion_cita`,
      {
        method: 'POST',
        headers: {
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id_cita: id_cita,
          token: token,
          fecha_expiracion: fecha_expiracion,
        }),
      }
    );

    // 2. Formatear fecha/hora para el email (zona horaria CDMX)
    const TZ = 'America/Mexico_City';
    const fechaFormato = new Date(fecha_cita).toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: TZ,
    });
    const horaFormato = new Date(fecha_cita).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
    const horaExpiracion = new Date(fecha_expiracion).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });

    // 3. Enviar email via Resend
    const emailResponse = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email_cliente,
      subject: `Confirma tu cita con ${barbero_nombre} - Tu Barbería`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>¡Hola ${nombre_cliente}!</h2>
          <p>Gracias por reservar tu cita en Tu Barbería.</p>

          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Detalles de tu cita:</h3>
            <p><strong>Barbero:</strong> ${barbero_nombre}</p>
            <p><strong>Servicio:</strong> ${servicio_nombre}</p>
            <p><strong>Fecha:</strong> ${fechaFormato}</p>
            <p><strong>Hora:</strong> ${horaFormato}</p>
          </div>

          <p style="color: #e74c3c;">⏰ <strong>Importante:</strong> Debes confirmar tu cita antes de ${horaExpiracion}</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${url_confirmacion}" style="background: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              Confirmar Cita
            </a>
          </div>

          <p style="color: #7f8c8d; font-size: 12px;">Si no solicitaste esta cita, ignora este email. El enlace expira en 10 minutos.</p>
          <hr style="border: none; border-top: 1px solid #ecf0f1; margin: 20px 0;">
          <p style="color: #7f8c8d; font-size: 12px; text-align: center;">Tu Barbería © 2026</p>
        </div>
      `,
    });

    if (emailResponse.error) {
      console.error('Resend error:', emailResponse.error);
      throw new Error(`Resend failed: ${emailResponse.error.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Email de confirmación enviado',
      email_id: emailResponse.data.id,
      token,
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
