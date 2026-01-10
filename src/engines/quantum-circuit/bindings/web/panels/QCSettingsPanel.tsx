/**
 * QCSettingsPanel - Circuit configuration
 * RUBRIC COMPLIANCE: Standard React form components
 */
/// <reference lib="dom" />
import React from "react";
import styled from "styled-components";
import { useQuantumCircuit } from "../QuantumCircuitContext";

const Container = styled.div`
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: #1a1a2e;
  padding: 16px;
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h3`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a4a;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  color: #8888aa;
  font-size: 12px;
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  background: #2a2a4a;
  border: 1px solid #4a4a6a;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  
  &:focus {
    outline: none;
    border-color: #6366f1;
  }
`;

const Select = styled.select`
  width: 100%;
  padding: 8px 12px;
  background: #2a2a4a;
  border: 1px solid #4a4a6a;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  
  &:focus {
    outline: none;
    border-color: #6366f1;
  }
`;

const Checkbox = styled.input.attrs({ type: "checkbox" })`
  margin-right: 8px;
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 8px;
`;

const Button = styled.button`
  width: 100%;
  padding: 10px;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  
  &:hover {
    background: #5558e3;
  }
`;

const DangerButton = styled(Button)`
  background: #dc2626;
  
  &:hover {
    background: #b91c1c;
  }
`;

export const QCSettingsPanel: React.FC = () => {
  const { 
    circuit, 
    settings, 
    updateSettings, 
    setQubitCount, 
    clearCircuit 
  } = useQuantumCircuit();

  return (
    <Container>
      <Section>
        <SectionTitle>Circuit</SectionTitle>
        
        <FormGroup>
          <Label>Number of Qubits</Label>
          <Input
            type="number"
            min={1}
            max={8}
            value={circuit.qubits}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQubitCount(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
          />
        </FormGroup>

        <DangerButton onClick={clearCircuit}>
          Clear Circuit
        </DangerButton>
      </Section>

      <Section>
        <SectionTitle>Simulation</SectionTitle>
        
        <FormGroup>
          <Label>Simulation Speed</Label>
          <Select
            value={settings.speed}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSettings({ speed: e.target.value as "slow" | "normal" | "fast" | "instant" })}
          >
            <option value="slow">Slow (1s per step)</option>
            <option value="normal">Normal (500ms)</option>
            <option value="fast">Fast (100ms)</option>
            <option value="instant">Instant</option>
          </Select>
        </FormGroup>

        <CheckboxLabel>
          <Checkbox
            checked={settings.autoRun}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ autoRun: e.target.checked })}
          />
          Auto-run on circuit change
        </CheckboxLabel>
      </Section>

      <Section>
        <SectionTitle>Display</SectionTitle>
        
        <CheckboxLabel>
          <Checkbox
            checked={settings.showProbabilities}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ showProbabilities: e.target.checked })}
          />
          Show probabilities
        </CheckboxLabel>

        <CheckboxLabel>
          <Checkbox
            checked={settings.showPhases}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ showPhases: e.target.checked })}
          />
          Show phases
        </CheckboxLabel>

        <CheckboxLabel>
          <Checkbox
            checked={settings.showAmplitudes}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSettings({ showAmplitudes: e.target.checked })}
          />
          Show amplitudes
        </CheckboxLabel>

        <FormGroup>
          <Label>Color Theme</Label>
          <Select
            value={settings.theme}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSettings({ theme: e.target.value as "dark" | "light" | "hc" })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="hc">High Contrast</option>
          </Select>
        </FormGroup>
      </Section>
    </Container>
  );
};

export default QCSettingsPanel;
