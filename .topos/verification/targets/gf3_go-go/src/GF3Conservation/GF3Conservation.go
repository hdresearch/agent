// Package GF3Conservation
// Dafny module GF3Conservation compiled into Go

package GF3Conservation

import (
	m__System "System_"
	_dafny "dafny"
	os "os"
)

var _ = os.Args
var _ _dafny.Dummy__
var _ m__System.Dummy__

type Dummy__ struct{}

// Definition of class Default__
type Default__ struct {
	dummy byte
}

func New_Default___() *Default__ {
	_this := Default__{}

	return &_this
}

type CompanionStruct_Default___ struct {
}

var Companion_Default___ = CompanionStruct_Default___{}

func (_this *Default__) Equals(other *Default__) bool {
	return _this == other
}

func (_this *Default__) EqualsGeneric(x interface{}) bool {
	other, ok := x.(*Default__)
	return ok && _this.Equals(other)
}

func (*Default__) String() string {
	return "GF3Conservation.Default__"
}
func (_this *Default__) ParentTraits_() []*_dafny.TraitID {
	return [](*_dafny.TraitID){}
}

var _ _dafny.TraitOffspring = &Default__{}

func (_static *CompanionStruct_Default___) TritValue(t Trit) _dafny.Int {
	var _source0 Trit = t
	_ = _source0
	{
		if _source0.Is_Minus() {
			return _dafny.IntOfInt64(-1)
		}
	}
	{
		if _source0.Is_Zero() {
			return _dafny.Zero
		}
	}
	{
		return _dafny.One
	}
}
func (_static *CompanionStruct_Default___) TritFromInt(n _dafny.Int) Trit {
	if (n).Cmp(_dafny.IntOfInt64(-1)) == 0 {
		return Companion_Trit_.Create_Minus_()
	} else if (n).Sign() == 0 {
		return Companion_Trit_.Create_Zero_()
	} else {
		return Companion_Trit_.Create_Plus_()
	}
}
func (_static *CompanionStruct_Default___) GF3Sum(trits _dafny.Sequence) _dafny.Int {
	var _0___accumulator _dafny.Int = _dafny.Zero
	_ = _0___accumulator
	goto TAIL_CALL_START
TAIL_CALL_START:
	if (_dafny.IntOfUint32((trits).Cardinality())).Sign() == 0 {
		return (_dafny.Zero).Plus(_0___accumulator)
	} else {
		_0___accumulator = (_0___accumulator).Plus(Companion_Default___.TritValue((trits).Select(0).(Trit)))
		var _in0 _dafny.Sequence = (trits).Drop(1)
		_ = _in0
		trits = _in0
		goto TAIL_CALL_START
	}
}
func (_static *CompanionStruct_Default___) GF3Conserved(trits _dafny.Sequence) bool {
	return !((_dafny.IntOfUint32((trits).Cardinality())).Sign() == 1) || (((Companion_Default___.GF3Sum(trits)).Modulo(_dafny.IntOfInt64(3))).Sign() == 0)
}
func (_static *CompanionStruct_Default___) IsBalanced(trits _dafny.Sequence) bool {
	return ((Companion_Default___.GF3Sum(trits)).Modulo(_dafny.IntOfInt64(3))).Sign() == 0
}
func (_static *CompanionStruct_Default___) Normalize(n _dafny.Int) _dafny.Int {
	var _0_mod3 _dafny.Int = (((n).Modulo(_dafny.IntOfInt64(3))).Plus(_dafny.IntOfInt64(3))).Modulo(_dafny.IntOfInt64(3))
	_ = _0_mod3
	if (_0_mod3).Sign() == 0 {
		return _dafny.Zero
	} else if (_0_mod3).Cmp(_dafny.One) == 0 {
		return _dafny.One
	} else {
		return _dafny.IntOfInt64(-1)
	}
}
func (_static *CompanionStruct_Default___) AddGF3(a Trit, b Trit) Trit {
	var _0_sum _dafny.Int = (Companion_Default___.TritValue(a)).Plus(Companion_Default___.TritValue(b))
	_ = _0_sum
	return Companion_Default___.TritFromInt(Companion_Default___.Normalize(_0_sum))
}
func (_static *CompanionStruct_Default___) NegateGF3(t Trit) Trit {
	var _source0 Trit = t
	_ = _source0
	{
		if _source0.Is_Minus() {
			return Companion_Trit_.Create_Plus_()
		}
	}
	{
		if _source0.Is_Zero() {
			return Companion_Trit_.Create_Zero_()
		}
	}
	{
		return Companion_Trit_.Create_Minus_()
	}
}
func (_static *CompanionStruct_Default___) BalanceTriad(triad _dafny.Sequence) Trit {
	var _0_sum _dafny.Int = Companion_Default___.GF3Sum(triad)
	_ = _0_sum
	var _1_mod3 _dafny.Int = ((((_dafny.Zero).Minus(_0_sum)).Modulo(_dafny.IntOfInt64(3))).Plus(_dafny.IntOfInt64(3))).Modulo(_dafny.IntOfInt64(3))
	_ = _1_mod3
	if (_1_mod3).Sign() == 0 {
		return Companion_Trit_.Create_Zero_()
	} else if (_1_mod3).Cmp(_dafny.One) == 0 {
		return Companion_Trit_.Create_Plus_()
	} else {
		return Companion_Trit_.Create_Minus_()
	}
}
func (_static *CompanionStruct_Default___) IsQuadBalanced(quad _dafny.Sequence) bool {
	return Companion_Default___.IsBalanced(quad)
}
func (_static *CompanionStruct_Default___) SumTrits(trits _dafny.Sequence) _dafny.Int {
	var sum _dafny.Int = _dafny.Zero
	_ = sum
	sum = _dafny.Zero
	var _hi0 _dafny.Int = _dafny.IntOfUint32((trits).Cardinality())
	_ = _hi0
	for _0_i := _dafny.Zero; _0_i.Cmp(_hi0) < 0; _0_i = _0_i.Plus(_dafny.One) {
		sum = (sum).Plus(Companion_Default___.TritValue((trits).Select((_0_i).Uint32()).(Trit)))
	}
	return sum
}
func (_static *CompanionStruct_Default___) CheckBalanced(trits _dafny.Sequence) bool {
	var balanced bool = false
	_ = balanced
	var _0_sum _dafny.Int
	_ = _0_sum
	var _out0 _dafny.Int
	_ = _out0
	_out0 = Companion_Default___.SumTrits(trits)
	_0_sum = _out0
	balanced = ((_0_sum).Modulo(_dafny.IntOfInt64(3))).Sign() == 0
	return balanced
}
func (_static *CompanionStruct_Default___) ComputeBalancingTrit(triad _dafny.Sequence) Trit {
	var balancing Trit = Companion_Trit_.Default()
	_ = balancing
	balancing = Companion_Default___.BalanceTriad(triad)
	return balancing
}
func (_static *CompanionStruct_Default___) TestBasicBalance() {
	var _0_t1 _dafny.Sequence
	_ = _0_t1
	_0_t1 = _dafny.SeqOf(Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Plus_())
	var _1_b1 Trit
	_ = _1_b1
	var _out0 Trit
	_ = _out0
	_out0 = Companion_Default___.ComputeBalancingTrit(_0_t1)
	_1_b1 = _out0
	var _2_t2 _dafny.Sequence
	_ = _2_t2
	_2_t2 = _dafny.SeqOf(Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Minus_(), Companion_Trit_.Create_Zero_())
	var _3_b2 Trit
	_ = _3_b2
	var _out1 Trit
	_ = _out1
	_out1 = Companion_Default___.ComputeBalancingTrit(_2_t2)
	_3_b2 = _out1
	var _4_t3 _dafny.Sequence
	_ = _4_t3
	_4_t3 = _dafny.SeqOf(Companion_Trit_.Create_Minus_(), Companion_Trit_.Create_Minus_(), Companion_Trit_.Create_Plus_())
	var _5_b3 Trit
	_ = _5_b3
	var _out2 Trit
	_ = _out2
	_out2 = Companion_Default___.ComputeBalancingTrit(_4_t3)
	_5_b3 = _out2
}
func (_static *CompanionStruct_Default___) Main(__noArgsParameter _dafny.Sequence) {
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("GF(3) Conservation Module - Formally Verified\n").VerbatimString(false))
	var _0_triad1 _dafny.Sequence
	_ = _0_triad1
	_0_triad1 = _dafny.SeqOf(Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Minus_())
	var _1_bal1 Trit
	_ = _1_bal1
	var _out0 Trit
	_ = _out0
	_out0 = Companion_Default___.ComputeBalancingTrit(_0_triad1)
	_1_bal1 = _out0
	var _2_check1 bool
	_ = _2_check1
	var _out1 bool
	_ = _out1
	_out1 = Companion_Default___.CheckBalanced(_dafny.Companion_Sequence_.Concatenate(_0_triad1, _dafny.SeqOf(_1_bal1)))
	_2_check1 = _out1
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("Test 1: [+1, +1, -1] + ").VerbatimString(false))
	_dafny.Print(_1_bal1)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes(" => Balanced: ").VerbatimString(false))
	_dafny.Print(_2_check1)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("\n").VerbatimString(false))
	var _3_triad2 _dafny.Sequence
	_ = _3_triad2
	_3_triad2 = _dafny.SeqOf(Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Zero_(), Companion_Trit_.Create_Minus_())
	var _4_bal2 Trit
	_ = _4_bal2
	var _out2 Trit
	_ = _out2
	_out2 = Companion_Default___.ComputeBalancingTrit(_3_triad2)
	_4_bal2 = _out2
	var _5_check2 bool
	_ = _5_check2
	var _out3 bool
	_ = _out3
	_out3 = Companion_Default___.CheckBalanced(_dafny.Companion_Sequence_.Concatenate(_3_triad2, _dafny.SeqOf(_4_bal2)))
	_5_check2 = _out3
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("Test 2: [+1, 0, -1] + ").VerbatimString(false))
	_dafny.Print(_4_bal2)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes(" => Balanced: ").VerbatimString(false))
	_dafny.Print(_5_check2)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("\n").VerbatimString(false))
	var _6_triad3 _dafny.Sequence
	_ = _6_triad3
	_6_triad3 = _dafny.SeqOf(Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Plus_(), Companion_Trit_.Create_Plus_())
	var _7_bal3 Trit
	_ = _7_bal3
	var _out4 Trit
	_ = _out4
	_out4 = Companion_Default___.ComputeBalancingTrit(_6_triad3)
	_7_bal3 = _out4
	var _8_check3 bool
	_ = _8_check3
	var _out5 bool
	_ = _out5
	_out5 = Companion_Default___.CheckBalanced(_dafny.Companion_Sequence_.Concatenate(_6_triad3, _dafny.SeqOf(_7_bal3)))
	_8_check3 = _out5
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("Test 3: [+1, +1, +1] + ").VerbatimString(false))
	_dafny.Print(_7_bal3)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes(" => Balanced: ").VerbatimString(false))
	_dafny.Print(_8_check3)
	_dafny.Print(_dafny.UnicodeSeqOfUtf8Bytes("\n").VerbatimString(false))
}

// End of class Default__

// Definition of datatype Trit
type Trit struct {
	Data_Trit_
}

func (_this Trit) Get_() Data_Trit_ {
	return _this.Data_Trit_
}

type Data_Trit_ interface {
	isTrit()
}

type CompanionStruct_Trit_ struct {
}

var Companion_Trit_ = CompanionStruct_Trit_{}

type Trit_Minus struct {
}

func (Trit_Minus) isTrit() {}

func (CompanionStruct_Trit_) Create_Minus_() Trit {
	return Trit{Trit_Minus{}}
}

func (_this Trit) Is_Minus() bool {
	_, ok := _this.Get_().(Trit_Minus)
	return ok
}

type Trit_Zero struct {
}

func (Trit_Zero) isTrit() {}

func (CompanionStruct_Trit_) Create_Zero_() Trit {
	return Trit{Trit_Zero{}}
}

func (_this Trit) Is_Zero() bool {
	_, ok := _this.Get_().(Trit_Zero)
	return ok
}

type Trit_Plus struct {
}

func (Trit_Plus) isTrit() {}

func (CompanionStruct_Trit_) Create_Plus_() Trit {
	return Trit{Trit_Plus{}}
}

func (_this Trit) Is_Plus() bool {
	_, ok := _this.Get_().(Trit_Plus)
	return ok
}

func (CompanionStruct_Trit_) Default() Trit {
	return Companion_Trit_.Create_Minus_()
}

func (_ CompanionStruct_Trit_) AllSingletonConstructors() _dafny.Iterator {
	i := -1
	return func() (interface{}, bool) {
		i++
		switch i {
		case 0:
			return Companion_Trit_.Create_Minus_(), true
		case 1:
			return Companion_Trit_.Create_Zero_(), true
		case 2:
			return Companion_Trit_.Create_Plus_(), true
		default:
			return Trit{}, false
		}
	}
}

func (_this Trit) String() string {
	switch _this.Get_().(type) {
	case nil:
		return "null"
	case Trit_Minus:
		{
			return "GF3Conservation.Trit.Minus"
		}
	case Trit_Zero:
		{
			return "GF3Conservation.Trit.Zero"
		}
	case Trit_Plus:
		{
			return "GF3Conservation.Trit.Plus"
		}
	default:
		{
			return "<unexpected>"
		}
	}
}

func (_this Trit) Equals(other Trit) bool {
	switch _this.Get_().(type) {
	case Trit_Minus:
		{
			_, ok := other.Get_().(Trit_Minus)
			return ok
		}
	case Trit_Zero:
		{
			_, ok := other.Get_().(Trit_Zero)
			return ok
		}
	case Trit_Plus:
		{
			_, ok := other.Get_().(Trit_Plus)
			return ok
		}
	default:
		{
			return false // unexpected
		}
	}
}

func (_this Trit) EqualsGeneric(other interface{}) bool {
	typed, ok := other.(Trit)
	return ok && _this.Equals(typed)
}

func Type_Trit_() _dafny.TypeDescriptor {
	return type_Trit_{}
}

type type_Trit_ struct {
}

func (_this type_Trit_) Default() interface{} {
	return Companion_Trit_.Default()
}

func (_this type_Trit_) String() string {
	return "GF3Conservation.Trit"
}
func (_this Trit) ParentTraits_() []*_dafny.TraitID {
	return [](*_dafny.TraitID){}
}

var _ _dafny.TraitOffspring = Trit{}

// End of datatype Trit
