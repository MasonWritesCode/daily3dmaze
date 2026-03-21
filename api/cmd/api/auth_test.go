package main

import "testing"

func TestValidateAuthRequest(t *testing.T) {
	t.Parallel()

	valid := authRequest{
		Username: "mason_dev",
		Password: "supersecure123",
	}

	if err := validateAuthRequest(valid); err != nil {
		t.Fatalf("expected valid auth request, got error: %v", err)
	}

	cases := []struct {
		name    string
		request authRequest
	}{
		{
			name: "short username",
			request: authRequest{
				Username: "ab",
				Password: "supersecure123",
			},
		},
		{
			name: "invalid username characters",
			request: authRequest{
				Username: "mason writes code",
				Password: "supersecure123",
			},
		},
		{
			name: "short password",
			request: authRequest{
				Username: "mason_dev",
				Password: "short",
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if err := validateAuthRequest(tc.request); err == nil {
				t.Fatalf("expected validation error for case %q", tc.name)
			}
		})
	}
}

func TestHashTokenIsDeterministic(t *testing.T) {
	t.Parallel()

	first := hashToken("session-token")
	second := hashToken("session-token")

	if first != second {
		t.Fatalf("expected deterministic token hash, got %q and %q", first, second)
	}

	if first == hashToken("different-token") {
		t.Fatal("expected different tokens to produce different hashes")
	}
}
