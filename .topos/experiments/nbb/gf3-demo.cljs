#!/usr/bin/env nbb

;; GF(3) Balancing Demo
;;
;; Demonstrates GF(3) field arithmetic and quad balancing.
;; This prototype validates the mathematical foundations before TypeScript port.

(ns gf3-demo
  (:require [clojure.pprint :refer [pprint]]))

;; ============================================================================
;; GF(3) Field Arithmetic
;; ============================================================================

(defn normalize-trit
  "Normalize an integer to a trit in {-1, 0, 1}."
  [n]
  (let [normalized (mod (+ (mod n 3) 3) 3)]
    (if (= normalized 2) -1 normalized)))

(defn add-gf3
  "Add two trits in GF(3)."
  [a b]
  (normalize-trit (+ a b)))

(defn negate-gf3
  "Compute additive inverse in GF(3)."
  [t]
  (- t))

(defn sum-gf3
  "Sum multiple trits in GF(3)."
  [trits]
  (normalize-trit (reduce + 0 trits)))

(defn balanced?
  "Check if trits sum to 0 in GF(3)."
  [trits]
  (zero? (sum-gf3 trits)))

(defn balance-triad
  "Given 3 trits, compute the 4th balancing trit."
  [[a b c]]
  (negate-gf3 (sum-gf3 [a b c])))

;; ============================================================================
;; Skill Hashing
;; ============================================================================

(defn string->trit
  "Hash a skill name to a trit deterministically."
  [s]
  (let [hash (reduce (fn [acc ch]
                       (let [code (.charCodeAt ch 0)
                             shifted (bit-shift-left acc 5)
                             subtracted (- shifted acc)]
                         (bit-and (+ subtracted code) 0xFFFFFFFF)))
                     0
                     (seq s))
        abs-hash (js/Math.abs hash)
        trit (- (mod abs-hash 3) 1)]
    trit))

;; ============================================================================
;; Quad Analysis
;; ============================================================================

(defn analyze-quad
  "Analyze a quad of skills."
  [skills]
  (let [trits (mapv string->trit skills)
        sum (sum-gf3 trits)
        balanced (zero? sum)
        distribution {:minus (count (filter #(= % -1) trits))
                      :ergodic (count (filter #(= % 0) trits))
                      :plus (count (filter #(= % 1) trits))}]
    {:skills skills
     :trits trits
     :sum sum
     :balanced balanced
     :distribution distribution}))

(defn trit->label
  "Convert trit to semantic label."
  [t]
  (case t
    -1 "MINUS"
    0 "ERGODIC"
    1 "PLUS"))

(defn print-quad-analysis
  "Pretty print quad analysis."
  [{:keys [skills trits sum balanced distribution]}]
  (println "\n=== Quad Analysis ===")
  (doseq [[skill trit] (map vector skills trits)]
    (println (str "  " skill ": " trit " (" (trit->label trit) ")")))
  (println (str "\nSum: " sum " (" (trit->label sum) ")"))
  (println (str "Balanced: " (if balanced "✓" "✗")))
  (println "\nDistribution:")
  (println (str "  MINUS (-1):   " (:minus distribution)))
  (println (str "  ERGODIC (0):  " (:ergodic distribution)))
  (println (str "  PLUS (+1):    " (:plus distribution))))

;; ============================================================================
;; Demo Scenarios
;; ============================================================================

(defn demo-balanced-quad
  "Test a balanced quad."
  []
  (println "\n🎯 Demo 1: Balanced Quad")
  (println "Testing: [gay-mcp, acsets, babashka, algebraic-rewriting]")
  (let [skills ["gay-mcp" "acsets" "babashka" "algebraic-rewriting"]
        analysis (analyze-quad skills)]
    (print-quad-analysis analysis)))

(defn demo-unbalanced-quad
  "Test an unbalanced quad."
  []
  (println "\n\n🎯 Demo 2: Unbalanced Quad")
  (println "Testing: [gay-mcp, gay-mcp, gay-mcp, gay-mcp]")
  (let [skills ["gay-mcp" "gay-mcp" "gay-mcp" "gay-mcp"]
        analysis (analyze-quad skills)]
    (print-quad-analysis analysis)))

(defn demo-balance-triad
  "Test balancing a triad."
  []
  (println "\n\n🎯 Demo 3: Balance a Triad")
  (let [triad ["gay-mcp" "acsets" "babashka"]
        trits (mapv string->trit triad)
        required-trit (balance-triad trits)]
    (println (str "Triad: " (vec triad)))
    (println (str "Trits: " trits))
    (println (str "\nRequired trit to balance: " required-trit " (" (trit->label required-trit) ")"))))

(defn demo-field-arithmetic
  "Test GF(3) field operations."
  []
  (println "\n\n🎯 Demo 4: GF(3) Field Arithmetic")
  (println "\nAddition table:")
  (doseq [a [-1 0 1]]
    (doseq [b [-1 0 1]]
      (println (str "  " a " + " b " = " (add-gf3 a b)))))
  
  (println "\nNegation:")
  (doseq [t [-1 0 1]]
    (println (str "  -(" t ") = " (negate-gf3 t)))))

;; ============================================================================
;; Main
;; ============================================================================

(defn -main []
  (println "╔════════════════════════════════════════════╗")
  (println "║  GF(3) Balancing Demo - nbb Prototype     ║")
  (println "╚════════════════════════════════════════════╝")
  
  (demo-field-arithmetic)
  (demo-balanced-quad)
  (demo-unbalanced-quad)
  (demo-balance-triad)
  
  (println "\n\n✨ Demo complete!")
  (println "Next step: Port successful patterns to TypeScript"))

(-main)
