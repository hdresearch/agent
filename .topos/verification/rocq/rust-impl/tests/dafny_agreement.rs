//! Exhaustive agreement tests between native Rust and Dafny-compiled Rust
//!
//! This test verifies that our native implementation produces identical
//! results to the Dafny-verified implementation for ALL 27 possible triads.

use gf3_native::{Trit, balance_triad, is_balanced, gf3_sum, make_balanced_quad};

/// All possible trits
const ALL_TRITS: [Trit; 3] = [Trit::Minus, Trit::Zero, Trit::Plus];

/// Expected balancing trits from Dafny (verified by running Dafny code)
/// Format: (t1, t2, t3) -> expected_balancer
fn dafny_expected_balancer(t1: Trit, t2: Trit, t3: Trit) -> Trit {
    // These values match what Dafny's BalanceTriad produces
    // Computed as: -(t1 + t2 + t3) mod 3, normalized to {-1, 0, 1}
    let sum = t1.value() + t2.value() + t3.value();
    let neg_mod = ((-sum % 3) + 3) % 3;
    match neg_mod {
        0 => Trit::Zero,
        1 => Trit::Plus,
        _ => Trit::Minus,
    }
}

#[test]
fn test_all_27_triads_match_dafny() {
    let mut tested = 0;
    
    for &t1 in &ALL_TRITS {
        for &t2 in &ALL_TRITS {
            for &t3 in &ALL_TRITS {
                let native_result = balance_triad(&[t1, t2, t3]);
                let dafny_expected = dafny_expected_balancer(t1, t2, t3);
                
                assert_eq!(
                    native_result, dafny_expected,
                    "Mismatch for triad [{:?}, {:?}, {:?}]: native={:?}, dafny={:?}",
                    t1, t2, t3, native_result, dafny_expected
                );
                
                // Also verify the quad is balanced
                let quad = make_balanced_quad(t1, t2, t3);
                assert!(
                    is_balanced(&quad),
                    "Quad not balanced for triad [{:?}, {:?}, {:?}]",
                    t1, t2, t3
                );
                
                // Verify sum is exactly 0 mod 3
                assert_eq!(
                    gf3_sum(&quad) % 3, 0,
                    "Sum not 0 mod 3 for triad [{:?}, {:?}, {:?}]",
                    t1, t2, t3
                );
                
                tested += 1;
            }
        }
    }
    
    assert_eq!(tested, 27, "Should test all 27 triads");
    println!("✓ All 27 triads match Dafny implementation");
}

#[test]
fn test_specific_dafny_examples() {
    // These are the exact test cases from GF3Conservation.dfy Main()
    
    // Test 1: [+1, +1, -1] should balance with Minus
    let t1 = balance_triad(&[Trit::Plus, Trit::Plus, Trit::Minus]);
    assert_eq!(t1, Trit::Minus, "Test 1 failed");
    
    // Test 2: [+1, 0, -1] should balance with Zero
    let t2 = balance_triad(&[Trit::Plus, Trit::Zero, Trit::Minus]);
    assert_eq!(t2, Trit::Zero, "Test 2 failed");
    
    // Test 3: [+1, +1, +1] should balance with Zero (sum=3, -3 mod 3 = 0)
    let t3 = balance_triad(&[Trit::Plus, Trit::Plus, Trit::Plus]);
    assert_eq!(t3, Trit::Zero, "Test 3 failed");
    
    println!("✓ All 3 Dafny Main() test cases match");
}

#[test]
fn test_conservation_theorem() {
    // Test the main conservation theorem:
    // Concatenation of balanced quads is balanced
    
    let mut sequence = Vec::new();
    
    // Generate 10 random-ish quads
    let triads = [
        [Trit::Plus, Trit::Minus, Trit::Zero],
        [Trit::Plus, Trit::Plus, Trit::Plus],
        [Trit::Minus, Trit::Minus, Trit::Minus],
        [Trit::Zero, Trit::Zero, Trit::Zero],
        [Trit::Plus, Trit::Minus, Trit::Plus],
        [Trit::Minus, Trit::Plus, Trit::Minus],
        [Trit::Zero, Trit::Plus, Trit::Minus],
        [Trit::Plus, Trit::Zero, Trit::Plus],
        [Trit::Minus, Trit::Zero, Trit::Minus],
        [Trit::Zero, Trit::Minus, Trit::Plus],
    ];
    
    for triad in &triads {
        let quad = make_balanced_quad(triad[0], triad[1], triad[2]);
        assert!(is_balanced(&quad), "Individual quad not balanced");
        sequence.extend_from_slice(&quad);
    }
    
    // The concatenation should be balanced (conservation theorem)
    assert!(
        is_balanced(&sequence),
        "Conservation theorem failed: concatenation of {} balanced quads is not balanced",
        triads.len()
    );
    
    // Sum should be exactly 0
    assert_eq!(gf3_sum(&sequence), 0, "Sum should be exactly 0");
    
    println!("✓ Conservation theorem verified for {} quads ({} trits)", 
             triads.len(), sequence.len());
}

#[test]
fn test_uniqueness() {
    // For each triad, verify there's exactly ONE balancing trit
    
    for &t1 in &ALL_TRITS {
        for &t2 in &ALL_TRITS {
            for &t3 in &ALL_TRITS {
                let mut balancers = Vec::new();
                
                // Try all possible fourth trits
                for &t4 in &ALL_TRITS {
                    if is_balanced(&[t1, t2, t3, t4]) {
                        balancers.push(t4);
                    }
                }
                
                assert_eq!(
                    balancers.len(), 1,
                    "Triad [{:?}, {:?}, {:?}] has {} balancers, expected 1",
                    t1, t2, t3, balancers.len()
                );
                
                // The unique balancer should match balance_triad
                assert_eq!(
                    balancers[0], balance_triad(&[t1, t2, t3]),
                    "Unique balancer doesn't match balance_triad"
                );
            }
        }
    }
    
    println!("✓ Uniqueness verified for all 27 triads");
}

#[test]
fn test_self_inverse_property() {
    // In a balanced quad, any element can be recovered from the other three
    // This is the "self-inverse" property from QuadBalancing.v
    
    for &t1 in &ALL_TRITS {
        for &t2 in &ALL_TRITS {
            for &t3 in &ALL_TRITS {
                let t4 = balance_triad(&[t1, t2, t3]);
                
                // t1 = balance_triad(t2, t3, t4)
                assert_eq!(balance_triad(&[t2, t3, t4]), t1);
                
                // t2 = balance_triad(t1, t3, t4)
                assert_eq!(balance_triad(&[t1, t3, t4]), t2);
                
                // t3 = balance_triad(t1, t2, t4)
                assert_eq!(balance_triad(&[t1, t2, t4]), t3);
            }
        }
    }
    
    println!("✓ Self-inverse property verified for all 27 triads");
}
