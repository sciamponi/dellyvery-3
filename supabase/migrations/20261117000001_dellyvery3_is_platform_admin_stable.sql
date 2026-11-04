-- DELLVERY 3 - Ajuste de volatilidade do helper de plataforma.
--
-- is_platform_admin apenas le profiles; marcar como STABLE permite que as
-- funcoes de estado/acesso (tambem STABLE) a chamem sem o alerta do linter.

alter function public.is_platform_admin() stable;
