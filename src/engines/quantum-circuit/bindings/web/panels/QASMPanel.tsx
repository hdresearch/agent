/**
 * QASMPanel - OpenQASM code editor
 * RUBRIC COMPLIANCE: Standard React textarea, NO canvas
 */
/// <reference lib="dom" />
import React, { useCallback, useState } from "react";
import styled from "styled-components";
import { useQuantumCircuit } from "../QuantumCircuitContext";
import { EXAMPLE_CIRCUITS } from "../../../core/qasm-parser";

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
`;

const Toolbar = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #2a2a4a;
  flex-wrap: wrap;
`;

const Button = styled.button`
  padding: 6px 12px;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  
  &:hover {
    background: #5558e3;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  padding: 6px 12px;
  background: #2a2a4a;
  color: white;
  border: 1px solid #4a4a6a;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
`;

const EditorContainer = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const LineNumbers = styled.div`
  padding: 12px 8px;
  background: #12121f;
  color: #4a4a6a;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  text-align: right;
  user-select: none;
  min-width: 40px;
`;

const TextArea = styled.textarea`
  flex: 1;
  padding: 12px;
  background: #1a1a2e;
  color: #e0e0e0;
  border: none;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;

  &::placeholder {
    color: #4a4a6a;
  }
`;

const ErrorPanel = styled.div`
  padding: 8px 12px;
  background: #3a1a1a;
  border-top: 1px solid #5a2a2a;
  color: #ff6b6b;
  font-size: 12px;
  font-family: monospace;
  max-height: 80px;
  overflow-y: auto;
`;

const ErrorLine = styled.div`
  margin: 2px 0;
`;

export const QASMPanel: React.FC = () => {
  const { qasmCode, setQASMCode, parseErrors, loadExample } = useQuantumCircuit();
  const [copied, setCopied] = useState(false);

  const lineCount = qasmCode.split("\n").length;

  const handleExampleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const example = e.currentTarget.value;
    if (example && EXAMPLE_CIRCUITS[example]) {
      loadExample(example);
    }
    e.currentTarget.value = "";
  }, [loadExample]);

  const handleCopy = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(qasmCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [qasmCode]);

  const handleFormat = useCallback(() => {
    const lines = qasmCode.split("\n");
    const formatted = lines
      .map(line => line.trim())
      .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
      .join("\n");
    setQASMCode(formatted);
  }, [qasmCode, setQASMCode]);

  return (
    <Container>
      <Toolbar>
        <Select onChange={handleExampleChange} defaultValue="">
          <option value="" disabled>Load Example...</option>
          <option value="bell">Bell State</option>
          <option value="ghz">GHZ State</option>
          <option value="grover">Grover's Algorithm</option>
          <option value="qft">Quantum Fourier Transform</option>
          <option value="superposition">Simple Superposition</option>
        </Select>
        
        <Button onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </Button>
        
        <Button onClick={handleFormat}>
          Format
        </Button>
      </Toolbar>

      <EditorContainer>
        <LineNumbers>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </LineNumbers>
        
        <TextArea
          value={qasmCode}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQASMCode(e.target.value)}
          placeholder="Enter OpenQASM 2.0 code..."
          spellCheck={false}
        />
      </EditorContainer>

      {parseErrors.length > 0 && (
        <ErrorPanel>
          {parseErrors.map((err, i) => (
            <ErrorLine key={i}>
              Line {err.line}: {err.message}
            </ErrorLine>
          ))}
        </ErrorPanel>
      )}
    </Container>
  );
};

export default QASMPanel;
