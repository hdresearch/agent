import sys
from typing import Callable, Any, TypeVar, NamedTuple
from math import floor
from itertools import count

import module_ as module_
import _dafny as _dafny
import System_ as System_

# Module: GF3Conservation

class default__:
    def  __init__(self):
        pass

    @staticmethod
    def TritValue(t):
        source0_ = t
        if True:
            if source0_.is_Minus:
                return -1
        if True:
            if source0_.is_Zero:
                return 0
        if True:
            return 1

    @staticmethod
    def TritFromInt(n):
        if (n) == (-1):
            return Trit_Minus()
        elif (n) == (0):
            return Trit_Zero()
        elif True:
            return Trit_Plus()

    @staticmethod
    def GF3Sum(trits):
        d_0___accumulator_ = 0
        while True:
            with _dafny.label():
                if (len(trits)) == (0):
                    return (0) + (d_0___accumulator_)
                elif True:
                    d_0___accumulator_ = (d_0___accumulator_) + (default__.TritValue((trits)[0]))
                    in0_ = _dafny.SeqWithoutIsStrInference((trits)[1::])
                    trits = in0_
                    raise _dafny.TailCall()
                break

    @staticmethod
    def GF3Conserved(trits):
        return not ((len(trits)) > (0)) or ((_dafny.euclidian_modulus(default__.GF3Sum(trits), 3)) == (0))

    @staticmethod
    def IsBalanced(trits):
        return (_dafny.euclidian_modulus(default__.GF3Sum(trits), 3)) == (0)

    @staticmethod
    def Normalize(n):
        d_0_mod3_ = _dafny.euclidian_modulus((_dafny.euclidian_modulus(n, 3)) + (3), 3)
        if (d_0_mod3_) == (0):
            return 0
        elif (d_0_mod3_) == (1):
            return 1
        elif True:
            return -1

    @staticmethod
    def AddGF3(a, b):
        d_0_sum_ = (default__.TritValue(a)) + (default__.TritValue(b))
        return default__.TritFromInt(default__.Normalize(d_0_sum_))

    @staticmethod
    def NegateGF3(t):
        source0_ = t
        if True:
            if source0_.is_Minus:
                return Trit_Plus()
        if True:
            if source0_.is_Zero:
                return Trit_Zero()
        if True:
            return Trit_Minus()

    @staticmethod
    def BalanceTriad(triad):
        d_0_sum_ = default__.GF3Sum(triad)
        d_1_mod3_ = _dafny.euclidian_modulus((_dafny.euclidian_modulus((0) - (d_0_sum_), 3)) + (3), 3)
        if (d_1_mod3_) == (0):
            return Trit_Zero()
        elif (d_1_mod3_) == (1):
            return Trit_Plus()
        elif True:
            return Trit_Minus()

    @staticmethod
    def IsQuadBalanced(quad):
        return default__.IsBalanced(quad)

    @staticmethod
    def SumTrits(trits):
        sum_: int = int(0)
        sum_ = 0
        hi0_ = len(trits)
        for d_0_i_ in range(0, hi0_):
            sum_ = (sum_) + (default__.TritValue((trits)[d_0_i_]))
        return sum_

    @staticmethod
    def CheckBalanced(trits):
        balanced: bool = False
        d_0_sum_: int
        out0_: int
        out0_ = default__.SumTrits(trits)
        d_0_sum_ = out0_
        balanced = (_dafny.euclidian_modulus(d_0_sum_, 3)) == (0)
        return balanced

    @staticmethod
    def ComputeBalancingTrit(triad):
        balancing: Trit = Trit.default()()
        balancing = default__.BalanceTriad(triad)
        return balancing

    @staticmethod
    def TestBasicBalance():
        d_0_t1_: _dafny.Seq
        d_0_t1_ = _dafny.SeqWithoutIsStrInference([Trit_Plus(), Trit_Plus(), Trit_Plus()])
        d_1_b1_: Trit
        out0_: Trit
        out0_ = default__.ComputeBalancingTrit(d_0_t1_)
        d_1_b1_ = out0_
        d_2_t2_: _dafny.Seq
        d_2_t2_ = _dafny.SeqWithoutIsStrInference([Trit_Plus(), Trit_Minus(), Trit_Zero()])
        d_3_b2_: Trit
        out1_: Trit
        out1_ = default__.ComputeBalancingTrit(d_2_t2_)
        d_3_b2_ = out1_
        d_4_t3_: _dafny.Seq
        d_4_t3_ = _dafny.SeqWithoutIsStrInference([Trit_Minus(), Trit_Minus(), Trit_Plus()])
        d_5_b3_: Trit
        out2_: Trit
        out2_ = default__.ComputeBalancingTrit(d_4_t3_)
        d_5_b3_ = out2_

    @staticmethod
    def Main(noArgsParameter__):
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "GF(3) Conservation Module - Formally Verified\n"))).VerbatimString(False))
        d_0_triad1_: _dafny.Seq
        d_0_triad1_ = _dafny.SeqWithoutIsStrInference([Trit_Plus(), Trit_Plus(), Trit_Minus()])
        d_1_bal1_: Trit
        out0_: Trit
        out0_ = default__.ComputeBalancingTrit(d_0_triad1_)
        d_1_bal1_ = out0_
        d_2_check1_: bool
        out1_: bool
        out1_ = default__.CheckBalanced((d_0_triad1_) + (_dafny.SeqWithoutIsStrInference([d_1_bal1_])))
        d_2_check1_ = out1_
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "Test 1: [+1, +1, -1] + "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_1_bal1_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, " => Balanced: "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_2_check1_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "\n"))).VerbatimString(False))
        d_3_triad2_: _dafny.Seq
        d_3_triad2_ = _dafny.SeqWithoutIsStrInference([Trit_Plus(), Trit_Zero(), Trit_Minus()])
        d_4_bal2_: Trit
        out2_: Trit
        out2_ = default__.ComputeBalancingTrit(d_3_triad2_)
        d_4_bal2_ = out2_
        d_5_check2_: bool
        out3_: bool
        out3_ = default__.CheckBalanced((d_3_triad2_) + (_dafny.SeqWithoutIsStrInference([d_4_bal2_])))
        d_5_check2_ = out3_
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "Test 2: [+1, 0, -1] + "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_4_bal2_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, " => Balanced: "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_5_check2_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "\n"))).VerbatimString(False))
        d_6_triad3_: _dafny.Seq
        d_6_triad3_ = _dafny.SeqWithoutIsStrInference([Trit_Plus(), Trit_Plus(), Trit_Plus()])
        d_7_bal3_: Trit
        out4_: Trit
        out4_ = default__.ComputeBalancingTrit(d_6_triad3_)
        d_7_bal3_ = out4_
        d_8_check3_: bool
        out5_: bool
        out5_ = default__.CheckBalanced((d_6_triad3_) + (_dafny.SeqWithoutIsStrInference([d_7_bal3_])))
        d_8_check3_ = out5_
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "Test 3: [+1, +1, +1] + "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_7_bal3_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, " => Balanced: "))).VerbatimString(False))
        _dafny.print(_dafny.string_of(d_8_check3_))
        _dafny.print((_dafny.SeqWithoutIsStrInference(map(_dafny.CodePoint, "\n"))).VerbatimString(False))


class Trit:
    @_dafny.classproperty
    def AllSingletonConstructors(cls):
        return [Trit_Minus(), Trit_Zero(), Trit_Plus()]
    @classmethod
    def default(cls, ):
        return lambda: Trit_Minus()
    def __ne__(self, __o: object) -> bool:
        return not self.__eq__(__o)
    @property
    def is_Minus(self) -> bool:
        return isinstance(self, Trit_Minus)
    @property
    def is_Zero(self) -> bool:
        return isinstance(self, Trit_Zero)
    @property
    def is_Plus(self) -> bool:
        return isinstance(self, Trit_Plus)

class Trit_Minus(Trit, NamedTuple('Minus', [])):
    def __dafnystr__(self) -> str:
        return f'GF3Conservation.Trit.Minus'
    def __eq__(self, __o: object) -> bool:
        return isinstance(__o, Trit_Minus)
    def __hash__(self) -> int:
        return super().__hash__()

class Trit_Zero(Trit, NamedTuple('Zero', [])):
    def __dafnystr__(self) -> str:
        return f'GF3Conservation.Trit.Zero'
    def __eq__(self, __o: object) -> bool:
        return isinstance(__o, Trit_Zero)
    def __hash__(self) -> int:
        return super().__hash__()

class Trit_Plus(Trit, NamedTuple('Plus', [])):
    def __dafnystr__(self) -> str:
        return f'GF3Conservation.Trit.Plus'
    def __eq__(self, __o: object) -> bool:
        return isinstance(__o, Trit_Plus)
    def __hash__(self) -> int:
        return super().__hash__()

