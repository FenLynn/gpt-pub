//go:build !windows

package main

import "fmt"

func main() {
	fmt.Println("Mediova GUI is built for Windows. Use GOOS=windows GOARCH=amd64.")
}
