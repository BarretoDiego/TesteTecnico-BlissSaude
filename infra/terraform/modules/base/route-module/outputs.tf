output "resource_ids" {
  description = "Recursos criados — o deployment depende deles para saber quando recriar."
  value = concat(
    [for r in aws_api_gateway_resource.level1 : r.id],
    [for r in aws_api_gateway_resource.level2 : r.id],
  )
}

# O preflight entra aqui junto: um `OPTIONS` novo precisa de redeploy do stage
# para passar a responder, igual a qualquer outro método.
output "integration_ids" {
  value = concat(
    [for i in aws_api_gateway_integration.this : i.id],
    [for i in aws_api_gateway_integration.preflight : i.id],
  )
}
output "route_keys" { value = keys(var.routes) }
