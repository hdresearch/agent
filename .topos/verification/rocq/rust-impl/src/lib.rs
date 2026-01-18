//! GF(3) Conservation - Native Rust Implementation
//!
//! This implementation is designed to be extracted by rocq-of-rust.
//! It mirrors the Dafny specification in GF3Conservation.dfy and
//! the Rocq specification in GF3Spec.v.
//!
//! The rocq-of-rust tool will translate this to Rocq, and we prove
//! that the extracted code refines the specification.

/// GF(3) element: {-1, 0, +1}
/// Matches Dafny's `datatype Trit = Minus | Zero | Plus`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trit {
    Minus, // -1
    Zero,  //  0
    Plus,  // +1
}

impl Trit {
    /// Convert trit to integer value
    /// Matches Dafny's TritValue and Rocq's trit_value
    #[inline]
    pub const fn value(self) -> i64 {
        match self {
            Trit::Minus => -1,
            Trit::Zero => 0,
            Trit::Plus => 1,
        }
    }

    /// Create trit from integer (assumes n ∈ {-1, 0, 1})
    /// Matches Dafny's TritFromInt and Rocq's trit_from_int
    #[inline]
    pub const fn from_int(n: i64) -> Self {
        match n {
            -1 => Trit::Minus,
            0 => Trit::Zero,
            _ => Trit::Plus,
        }
    }

    /// Negate trit in GF(3)
    /// Matches Dafny's NegateGF3 and Rocq's negate_gf3
    #[inline]
    pub const fn negate(self) -> Self {
        match self {
            Trit::Minus => Trit::Plus,
            Trit::Zero => Trit::Zero,
            Trit::Plus => Trit::Minus,
        }
    }

    /// Add two trits in GF(3)
    /// Matches Dafny's AddGF3 and Rocq's add_gf3
    #[inline]
    pub const fn add(self, other: Self) -> Self {
        let sum = self.value() + other.value();
        Trit::from_int(normalize(sum))
    }
}

/// Normalize integer to {-1, 0, 1} range
/// Matches Dafny's Normalize and Rocq's normalize
#[inline]
pub const fn normalize(n: i64) -> i64 {
    // ((n % 3) + 3) % 3 maps to {0, 1, 2}
    // Then we map: 0 -> 0, 1 -> 1, 2 -> -1
    let mod3 = ((n % 3) + 3) % 3;
    match mod3 {
        0 => 0,
        1 => 1,
        _ => -1,
    }
}

/// Sum of trit values
/// Matches Dafny's GF3Sum and Rocq's gf3_sum
pub fn gf3_sum(trits: &[Trit]) -> i64 {
    trits.iter().map(|t| t.value()).sum()
}

/// Check if a slice of trits is balanced (sum ≡ 0 mod 3)
/// Matches Dafny's IsBalanced and Rocq's is_balanced
#[inline]
pub fn is_balanced(trits: &[Trit]) -> bool {
    gf3_sum(trits) % 3 == 0
}

/// Compute the balancing trit for a triad
/// Matches Dafny's BalanceTriad and Rocq's balance_triad
///
/// # Precondition
/// triad.len() == 3
pub fn balance_triad(triad: &[Trit; 3]) -> Trit {
    let sum = triad[0].value() + triad[1].value() + triad[2].value();
    let neg_sum = -sum;
    let mod3 = ((neg_sum % 3) + 3) % 3;
    match mod3 {
        0 => Trit::Zero,
        1 => Trit::Plus,
        _ => Trit::Minus,
    }
}

/// Check if a quad is balanced
/// Matches Dafny's IsQuadBalanced and Rocq's is_quad_balanced
#[inline]
pub fn is_quad_balanced(quad: &[Trit; 4]) -> bool {
    is_balanced(quad)
}

/// Balance a triad by computing the fourth trit
/// Returns the complete balanced quad
///
/// # Invariant
/// is_quad_balanced(&result) == true
pub fn make_balanced_quad(t1: Trit, t2: Trit, t3: Trit) -> [Trit; 4] {
    let t4 = balance_triad(&[t1, t2, t3]);
    [t1, t2, t3, t4]
}

/// Check conservation: all quads in sequence are balanced
/// Matches Dafny's GF3ConservationTheorem precondition
pub fn check_conservation(trits: &[Trit]) -> bool {
    if trits.len() % 4 != 0 {
        return false;
    }
    
    trits
        .chunks_exact(4)
        .all(|chunk| {
            let quad: [Trit; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
            is_quad_balanced(&quad)
        })
}

// ============================================================================
// SplitMix64 PRNG for Deterministic Color Generation
// ============================================================================

/// Golden ratio constant for SplitMix64
/// φ = (1 + √5) / 2, scaled to 64 bits
pub const GOLDEN_GAMMA: u64 = 0x9e3779b97f4a7c15;

/// Plastic constant gamma for GF(3) systems
/// ρ ≈ 1.324718, the real root of x³ = x + 1
pub const PLASTIC_GAMMA: u64 = 0x5533b9a6c4f208a5;

/// SplitMix64 PRNG state
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    /// Create new PRNG with given seed
    pub const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// Mix function - bijective scrambling
    #[inline]
    fn mix(mut z: u64) -> u64 {
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }

    /// Generate next random u64
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(GOLDEN_GAMMA);
        Self::mix(self.state)
    }

    /// Generate next trit deterministically
    pub fn next_trit(&mut self) -> Trit {
        Trit::from_int((self.next_u64() % 3) as i64 - 1)
    }

    /// Get color at specific index (1-based)
    pub fn color_at(seed: u64, index: u64) -> u64 {
        let mut rng = Self::new(seed);
        // Advance to position
        for _ in 0..index {
            rng.next_u64();
        }
        // Use state directly for color
        rng.state
    }

    /// Generate trit at specific index
    pub fn trit_at(seed: u64, index: u64) -> Trit {
        let color = Self::color_at(seed, index);
        Trit::from_int((color % 3) as i64 - 1)
    }
}

// ============================================================================
// Share3 Hash for Skill -> Trit Mapping
// ============================================================================

/// Compute Share3 hash for a skill name
/// Returns (hash, trit, color)
pub fn share3_hash(name: &str, seed: u64) -> (u64, Trit, u32) {
    // FNV-1a hash of name
    let mut hash: u64 = 0xcbf29ce484222325; // FNV offset basis
    for byte in name.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3); // FNV prime
    }
    
    // Mix with seed
    let mut rng = SplitMix64::new(hash ^ seed);
    let mixed = rng.next_u64();
    
    // Trit from hash
    let trit = Trit::from_int((mixed % 3) as i64 - 1);
    
    // Color from upper bits (RGB packed)
    let color = (mixed >> 40) as u32 & 0xFFFFFF;
    
    (mixed, trit, color)
}

/// Find skills that balance a triad sum
pub fn find_balancing_trit(triad_sum: i64) -> Trit {
    let needed = ((-triad_sum % 3) + 3) % 3;
    match needed {
        0 => Trit::Zero,
        1 => Trit::Plus,
        _ => Trit::Minus,
    }
}

// ============================================================================
// Tests - These verify agreement with Dafny/Rocq specs
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trit_values() {
        assert_eq!(Trit::Minus.value(), -1);
        assert_eq!(Trit::Zero.value(), 0);
        assert_eq!(Trit::Plus.value(), 1);
    }

    #[test]
    fn test_normalize() {
        assert_eq!(normalize(-2), 1);  // -2 ≡ 1 (mod 3)
        assert_eq!(normalize(-1), -1);
        assert_eq!(normalize(0), 0);
        assert_eq!(normalize(1), 1);
        assert_eq!(normalize(2), -1);  // 2 ≡ -1 (mod 3)
        assert_eq!(normalize(3), 0);
    }

    #[test]
    fn test_add_gf3() {
        // Addition table for GF(3)
        assert_eq!(Trit::Plus.add(Trit::Plus), Trit::Minus);   // 1 + 1 = 2 ≡ -1
        assert_eq!(Trit::Plus.add(Trit::Minus), Trit::Zero);   // 1 + (-1) = 0
        assert_eq!(Trit::Minus.add(Trit::Minus), Trit::Plus);  // -1 + (-1) = -2 ≡ 1
    }

    #[test]
    fn test_balance_triad() {
        // [+1, +1, +1] needs -1 + -1 + -1 = -3 ≡ 0, so balancer is 0
        // Wait: sum = 3, -3 mod 3 = 0, so Zero
        let t1 = balance_triad(&[Trit::Plus, Trit::Plus, Trit::Plus]);
        assert_eq!(t1, Trit::Zero);
        
        // [+1, +1, -1] sum = 1, -1 mod 3 = 2, so Minus
        let t2 = balance_triad(&[Trit::Plus, Trit::Plus, Trit::Minus]);
        assert_eq!(t2, Trit::Minus);
        
        // [+1, 0, -1] sum = 0, 0 mod 3 = 0, so Zero
        let t3 = balance_triad(&[Trit::Plus, Trit::Zero, Trit::Minus]);
        assert_eq!(t3, Trit::Zero);
    }

    #[test]
    fn test_quad_balanced() {
        // Every balanced triad + balancer should be balanced
        let triads = [
            [Trit::Plus, Trit::Plus, Trit::Plus],
            [Trit::Plus, Trit::Plus, Trit::Minus],
            [Trit::Plus, Trit::Minus, Trit::Minus],
            [Trit::Minus, Trit::Minus, Trit::Minus],
            [Trit::Zero, Trit::Zero, Trit::Zero],
        ];
        
        for triad in &triads {
            let quad = make_balanced_quad(triad[0], triad[1], triad[2]);
            assert!(is_quad_balanced(&quad), "Failed for triad {:?}", triad);
        }
    }

    #[test]
    fn test_conservation() {
        // Build a conserved sequence
        let q1 = make_balanced_quad(Trit::Plus, Trit::Plus, Trit::Plus);
        let q2 = make_balanced_quad(Trit::Minus, Trit::Zero, Trit::Plus);
        
        let mut sequence = Vec::new();
        sequence.extend_from_slice(&q1);
        sequence.extend_from_slice(&q2);
        
        assert!(check_conservation(&sequence));
        assert!(is_balanced(&sequence)); // Main theorem
    }

    #[test]
    fn test_splitmix64_determinism() {
        let mut rng1 = SplitMix64::new(1069);
        let mut rng2 = SplitMix64::new(1069);
        
        for _ in 0..100 {
            assert_eq!(rng1.next_u64(), rng2.next_u64());
        }
    }

    #[test]
    fn test_share3_determinism() {
        let (h1, t1, c1) = share3_hash("gay-mcp", 1069);
        let (h2, t2, c2) = share3_hash("gay-mcp", 1069);
        
        assert_eq!(h1, h2);
        assert_eq!(t1, t2);
        assert_eq!(c1, c2);
    }
}
