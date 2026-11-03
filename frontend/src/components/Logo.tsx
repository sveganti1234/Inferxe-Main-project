export function LogoMark({ size = 34, theme }: { size?: number; theme?: 'light' | 'dark' }) {
  if (theme === 'light') {
    return (
      <img
        src="/Green Data Cloud Logo.png"
        alt="Inferxe"
        width={size}
        height={size}
        className="logo__mark logo__mark--light"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: Math.round(size * 0.25),
          display: 'block',
        }}
      />
    )
  }

  if (theme === 'dark') {
    return (
      <img
        src="/images/logo.jpg"
        alt="Inferxe"
        width={size}
        height={size}
        className="logo__mark logo__mark--dark"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: Math.round(size * 0.25),
          display: 'block',
        }}
      />
    )
  }

  return (
    <>
      <img
        src="/images/logo.jpg"
        alt="Inferxe"
        width={size}
        height={size}
        className="logo__mark logo__mark--dark"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: Math.round(size * 0.25),
        }}
      />
      <img
        src="/Green Data Cloud Logo.png"
        alt="Inferxe"
        width={size}
        height={size}
        className="logo__mark logo__mark--light"
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: Math.round(size * 0.25),
        }}
      />
    </>
  )
}

export function Logo({
  size = 34,
  showWord = true,
  theme,
}: {
  size?: number
  showWord?: boolean
  theme?: 'light' | 'dark'
}) {
  return (
    <span className="logo">
      <LogoMark size={size} theme={theme} />
      {showWord && (
        <span className="logo__word">
          Infer<span>xe</span>
        </span>
      )}
    </span>
  )
}
