#!/bin/sh
# Git "clean" filter for RemoteServiceGatewayCredentials tokens.
#
# Purpose: keep RSG API tokens out of git while still committing Scene.scene.
# Your working-tree Scene.scene keeps the real tokens (so the lens runs),
# but git stores placeholder values instead.
#
# Reads the file on stdin, writes the scrubbed version to stdout.
# Token lines are matched by key name and their values replaced with the
# same placeholders the RemoteServiceGatewayCredentials component ships with.

sed -E \
  -e 's/^([[:space:]]*openAIToken:)[[:space:]]*.*/\1 "[INSERT OPENAI TOKEN HERE]"/' \
  -e 's/^([[:space:]]*googleToken:)[[:space:]]*.*/\1 "[INSERT GOOGLE TOKEN HERE]"/' \
  -e 's/^([[:space:]]*snapToken:)[[:space:]]*.*/\1 "[INSERT SNAP TOKEN HERE]"/'
