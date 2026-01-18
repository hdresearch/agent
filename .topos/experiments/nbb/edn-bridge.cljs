#!/usr/bin/env nbb

;; EDN Protocol Bridge Prototype
;;
;; Tests JSON-RPC ↔ EDN translation for homoiconic data exchange.
;; Explores S-expression based protocol design.

(ns edn-bridge
  (:require [clojure.pprint :refer [pprint]]
            [clojure.edn :as edn]))

;; ============================================================================
;; JSON-RPC Types
;; ============================================================================

(defrecord JsonRpcRequest [jsonrpc method params id])
(defrecord JsonRpcResponse [jsonrpc result id])
(defrecord JsonRpcError [jsonrpc error id])

;; ============================================================================
;; JSON ↔ EDN Translation
;; ============================================================================

(defn json->edn
  "Convert JSON-like structure to EDN."
  [json-obj]
  ;; In nbb, JS objects are already ClojureScript data
  ;; This would be more complex in actual bridge implementation
  (if (map? json-obj)
    json-obj
    (js->clj json-obj :keywordize-keys true)))

(defn edn->json
  "Convert EDN to JSON-like structure."
  [edn-data]
  ;; Convert keywords to strings for JSON compatibility
  (clj->js edn-data))

;; ============================================================================
;; S-Expression Protocol
;; ============================================================================

(defn make-request
  "Create a JSON-RPC request as EDN."
  [method params id]
  {:jsonrpc "2.0"
   :method method
   :params params
   :id id})

(defn make-response
  "Create a JSON-RPC response as EDN."
  [result id]
  {:jsonrpc "2.0"
   :result result
   :id id})

(defn make-error
  "Create a JSON-RPC error as EDN."
  [code message id]
  {:jsonrpc "2.0"
   :error {:code code
           :message message}
   :id id})

;; ============================================================================
;; Protocol Handlers
;; ============================================================================

(defmulti handle-method
  "Handle JSON-RPC methods."
  (fn [method params] method))

(defmethod handle-method "gf3/balance-triad"
  [_ {:keys [trits]}]
  (let [sum (reduce + 0 trits)
        normalized (mod (+ (mod sum 3) 3) 3)
        sum-trit (if (= normalized 2) -1 normalized)
        required (- sum-trit)]
    {:required-trit required
     :balanced true}))

(defmethod handle-method "gf3/analyze-quad"
  [_ {:keys [skills]}]
  (let [string->trit (fn [s]
                       (let [hash (reduce (fn [acc ch]
                                            (let [code (.charCodeAt ch 0)
                                                  shifted (bit-shift-left acc 5)
                                                  subtracted (- shifted acc)]
                                              (bit-and (+ subtracted code) 0xFFFFFFFF)))
                                          0
                                          (seq s))
                             abs-hash (js/Math.abs hash)]
                         (- (mod abs-hash 3) 1)))
        trits (mapv string->trit skills)
        sum (reduce + 0 trits)
        normalized (mod (+ (mod sum 3) 3) 3)
        sum-trit (if (= normalized 2) -1 normalized)]
    {:skills skills
     :trits trits
     :sum sum-trit
     :balanced (zero? sum-trit)}))

(defmethod handle-method "agent/decompose-task"
  [_ {:keys [task-type]}]
  (case task-type
    "implement-feature"
    [{:agent-type "PLUS" :desc "Generate implementation"}
     {:agent-type "MINUS" :desc "Validate correctness"}
     {:agent-type "ERGODIC" :desc "Integrate into system"}]
    
    "debug-issue"
    [{:agent-type "MINUS" :desc "Analyze bug"}
     {:agent-type "ERGODIC" :desc "Plan fix strategy"}
     {:agent-type "PLUS" :desc "Generate fix"}]
    
    ;; Default
    [{:agent-type "ERGODIC" :desc "Coordinate task"}]))

(defmethod handle-method :default
  [method _]
  (throw (ex-info "Method not found" {:method method})))

;; ============================================================================
;; Bridge Server
;; ============================================================================

(defn process-request
  "Process a JSON-RPC request and return response."
  [request]
  (try
    (let [{:keys [method params id]} request
          result (handle-method method params)]
      (make-response result id))
    (catch js/Error e
      (make-error -32603 (.-message e) (:id request)))))

;; ============================================================================
;; Demo Scenarios
;; ============================================================================

(defn demo-gf3-balance
  "Demo: GF(3) balancing via bridge."
  []
  (println "\n🎯 Demo 1: GF(3) Balance via Bridge")
  (let [request (make-request "gf3/balance-triad"
                              {:trits [1 1 -1]}
                              1)
        response (process-request request)]
    (println "\nRequest:")
    (pprint request)
    (println "\nResponse:")
    (pprint response)))

(defn demo-quad-analysis
  "Demo: Quad analysis via bridge."
  []
  (println "\n\n🎯 Demo 2: Quad Analysis via Bridge")
  (let [request (make-request "gf3/analyze-quad"
                              {:skills ["gay-mcp" "acsets" "babashka" "algebraic-rewriting"]}
                              2)
        response (process-request request)]
    (println "\nRequest:")
    (pprint request)
    (println "\nResponse:")
    (pprint response)))

(defn demo-task-decomposition
  "Demo: Task decomposition via bridge."
  []
  (println "\n\n🎯 Demo 3: Task Decomposition via Bridge")
  (let [request (make-request "agent/decompose-task"
                              {:task-type "implement-feature"}
                              3)
        response (process-request request)]
    (println "\nRequest:")
    (pprint request)
    (println "\nResponse:")
    (pprint response)))

(defn demo-error-handling
  "Demo: Error handling in bridge."
  []
  (println "\n\n🎯 Demo 4: Error Handling")
  (let [request (make-request "nonexistent/method"
                              {}
                              4)
        response (process-request request)]
    (println "\nRequest:")
    (pprint request)
    (println "\nResponse:")
    (pprint response)))

(defn demo-homoiconicity
  "Demo: Code-as-data with S-expressions."
  []
  (println "\n\n🎯 Demo 5: Homoiconicity")
  (println "\nS-expression advantage: Code is data, data is code")
  
  ;; Define a computation as data
  (let [computation '(+ (* 2 3) (/ 10 2))
        result (eval computation)]
    (println "\nComputation (as data):")
    (println (str "  " computation))
    (println "\nResult:")
    (println (str "  " result)))
  
  ;; Transform the computation
  (let [original '(+ 1 2)
        transformed (list* 'do (list 'println "Computing...") (list original))]
    (println "\nOriginal:")
    (println (str "  " original))
    (println "\nTransformed (added side effect):")
    (println (str "  " transformed))
    (println "\nExecuting transformed:")
    (eval transformed)))

;; ============================================================================
;; Main
;; ============================================================================

(defn -main []
  (println "╔════════════════════════════════════════════╗")
  (println "║  EDN Protocol Bridge - nbb Prototype      ║")
  (println "╚════════════════════════════════════════════╝")
  
  (demo-gf3-balance)
  (demo-quad-analysis)
  (demo-task-decomposition)
  (demo-error-handling)
  (demo-homoiconicity)
  
  (println "\n\n✨ Demo complete!")
  (println "Insights:")
  (println "  - JSON-RPC ↔ EDN translation is straightforward")
  (println "  - S-expressions enable code-as-data metaprogramming")
  (println "  - Protocol can be extended without breaking changes")
  (println "\nNext step: Implement EDN bridge in TypeScript (if needed)"))

(-main)
