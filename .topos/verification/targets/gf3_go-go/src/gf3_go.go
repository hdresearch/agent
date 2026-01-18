// Dafny program GF3Conservation.dfy compiled into Go
package main

import (
	m_GF3Conservation "GF3Conservation"
	m__System "System_"
	_dafny "dafny"
	os "os"
)

var _ = os.Args
var _ _dafny.Dummy__
var _ m__System.Dummy__
var _ m_GF3Conservation.Dummy__

func main() {
	defer _dafny.CatchHalt()
	m_GF3Conservation.Companion_Default___.Main(_dafny.UnicodeFromMainArguments(os.Args))
}
