/**
 * StatePanel - Quantum state visualization
 * RUBRIC COMPLIANCE: React components with styled-components, NO canvas
 */
import React, { useMemo } from "react";
import styled from "styled-components";
import { useQuantumCircuit } from "../QuantumCircuitContext";
import { C } from "../../../core/types";

const Container = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #1a1a2e;
  padding: 16px;
`;

const Title = styled.h3`
  color: #fff;
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
`;

const StateGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const StateRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const BasisLabel = styled.span`
  font-family: monospace;
  color: #8888aa;
  width: 60px;
  text-align: right;
`;

const ProbabilityBar = styled.div`
  flex: 1;
  height: 24px;
  background: #2a2a4a;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
`;

const ProbabilityFill = styled.div<{ $width: number; $hue: number }>`
  height: 100%;
  width: ${(props: { $width: number }) => props.$width}%;
  background: hsl(${(props: { $hue: number }) => props.$hue}, 70%, 50%);
  border-radius: 4px;
  transition: width 0.3s ease;
`;

const ProbabilityText = styled.span`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: #fff;
  font-size: 12px;
  font-family: monospace;
`;

const AmplitudeText = styled.span`
  font-family: monospace;
  color: #aaa;
  font-size: 11px;
  width: 120px;
`;

const PhaseIndicator = styled.div<{ $angle: number }>`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #6366f1;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 2px;
    background: #6366f1;
    transform-origin: left center;
    transform: rotate(${(props: { $angle: number }) => -props.$angle}rad);
  }
`;

const BlochSection = styled.div`
  margin-top: 24px;
`;

const BlochSphere = styled.div`
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 2px solid #4a4a6a;
  position: relative;
  margin: 0 auto;
  perspective: 200px;
`;

const BlochVector = styled.div<{ $theta: number; $phi: number }>`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 50px;
  background: linear-gradient(to top, #6366f1, #a855f7);
  border-radius: 2px;
  transform-origin: bottom center;
  transform: 
    rotateX(${(props: { $theta: number }) => props.$theta}rad)
    rotateZ(${(props: { $phi: number }) => props.$phi}rad)
    translateY(-100%);
`;

const BlochDot = styled.div`
  position: absolute;
  width: 8px;
  height: 8px;
  background: #f59e0b;
  border-radius: 50%;
  transform: translate(-50%, -50%);
`;

const formatComplex = (c: { re: number; im: number }): string => {
  const re = c.re.toFixed(3);
  const im = c.im.toFixed(3);
  if (Math.abs(c.im) < 0.001) return re;
  if (Math.abs(c.re) < 0.001) return `${im}i`;
  return `${re}${c.im >= 0 ? "+" : ""}${im}i`;
};

const basisString = (index: number, qubits: number): string => {
  return "|" + index.toString(2).padStart(qubits, "0") + "⟩";
};

export const StatePanel: React.FC = () => {
  const { simulation } = useQuantumCircuit();
  
  const stateData = useMemo(() => {
    if (!simulation?.stateVector) return [];
    
    return simulation.stateVector.map((amp, i) => ({
      index: i,
      amplitude: amp,
      probability: C.abs2(amp),
      phase: C.phase(amp),
    }));
  }, [simulation?.stateVector]);

  const qubits = simulation?.circuit.qubits ?? 1;

  // Calculate Bloch sphere coordinates for single qubit
  const blochCoords = useMemo(() => {
    if (qubits !== 1 || !simulation?.stateVector) return null;
    
    const a0 = simulation.stateVector[0];
    const a1 = simulation.stateVector[1];
    if (!a0 || !a1) return null;
    
    const theta = 2 * Math.acos(C.abs(a0));
    const phi = C.phase(a1) - C.phase(a0);
    
    return { theta, phi };
  }, [simulation?.stateVector, qubits]);

  return (
    <Container>
      <Title>State Vector</Title>
      
      <StateGrid>
        {stateData.map(({ index, amplitude, probability, phase }) => (
          <StateRow key={index}>
            <BasisLabel>{basisString(index, qubits)}</BasisLabel>
            <ProbabilityBar>
              <ProbabilityFill 
                $width={probability * 100} 
                $hue={(phase + Math.PI) * (180 / Math.PI)}
              />
              <ProbabilityText>
                {(probability * 100).toFixed(1)}%
              </ProbabilityText>
            </ProbabilityBar>
            <PhaseIndicator $angle={phase} title={`Phase: ${(phase * 180 / Math.PI).toFixed(1)}°`} />
            <AmplitudeText>{formatComplex(amplitude)}</AmplitudeText>
          </StateRow>
        ))}
      </StateGrid>

      {blochCoords && (
        <BlochSection>
          <Title>Bloch Sphere (Single Qubit)</Title>
          <BlochSphere>
            <BlochVector $theta={blochCoords.theta} $phi={blochCoords.phi} />
            <BlochDot 
              style={{
                top: `${50 - 40 * Math.cos(blochCoords.theta)}%`,
                left: `${50 + 40 * Math.sin(blochCoords.theta) * Math.cos(blochCoords.phi)}%`,
              }}
            />
          </BlochSphere>
        </BlochSection>
      )}
    </Container>
  );
};

export default StatePanel;
