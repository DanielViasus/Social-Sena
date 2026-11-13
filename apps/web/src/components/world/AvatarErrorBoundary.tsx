import { Component, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback: ReactNode
  // Al cambiar esta clave se reintenta el render (por ejemplo, cuando se publica una animacion nueva).
  resetKey?: string
}

type State = { failed: boolean }

// Si el avatar animado lanza una excepcion al renderizar, muestra el avatar de respaldo
// en lugar de dejar la escena en blanco.
export class AvatarErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[avatar-animations] Fallo al dibujar el avatar animado; se usa el avatar de respaldo.', error)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
