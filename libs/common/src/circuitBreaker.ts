/**
 * Circuit Breaker Pattern Implementation
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests blocked
 * - HALF_OPEN: Testing if service recovered
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitBreakerOptions = {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms to wait before transitioning to HALF_OPEN */
  resetTimeout: number;
  /** Number of successful calls needed to close circuit from HALF_OPEN */
  successThreshold: number;
  /** Called when circuit state changes */
  onStateChange?: (state: CircuitState, previousState: CircuitState) => void;
};

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  successThreshold: 3,
};

export class CircuitBreakerError extends Error {
  constructor(serviceName: string) {
    super(`Circuit breaker is OPEN for service: ${serviceName}`);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private nextAttemptTime: number | null = null;

  constructor(
    private readonly serviceName: string,
    private readonly options: CircuitBreakerOptions = DEFAULT_OPTIONS,
    private readonly logger?: { info: (msg: string, meta?: Record<string, unknown>) => void }
  ) {}

  get currentState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.transitionTo('HALF_OPEN');
    }
    return this.state;
  }

  private transitionTo(newState: CircuitState) {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    
    // Reset counters on state change
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
      this.lastFailureTime = null;
      this.nextAttemptTime = null;
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0;
    } else if (newState === 'OPEN') {
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
    }

    this.logger?.info('circuit_breaker_state_changed', {
      service: this.serviceName,
      previousState,
      newState,
      failureCount: this.failureCount,
    });

    this.options.onStateChange?.(newState, previousState);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    if (state === 'OPEN') {
      throw new CircuitBreakerError(this.serviceName);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN immediately opens the circuit
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      service: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('CLOSED');
  }

  /**
   * Force open the circuit breaker
   */
  forceOpen(): void {
    this.transitionTo('OPEN');
  }
}

/**
 * Circuit Breaker Registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly logger?: { info: (msg: string, meta?: Record<string, unknown>) => void }
  ) {}

  /**
   * Get or create a circuit breaker for a service
   */
  get(serviceName: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    let breaker = this.breakers.get(serviceName);
    if (!breaker) {
      breaker = new CircuitBreaker(serviceName, { ...DEFAULT_OPTIONS, ...options }, this.logger);
      this.breakers.set(serviceName, breaker);
    }
    return breaker;
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats() {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(b => b.reset());
  }
}

// Default registry for application-wide use
export const defaultCircuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Get or create a circuit breaker from the default registry
 */
export function getCircuitBreaker(serviceName: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  return defaultCircuitBreakerRegistry.get(serviceName, options);
}