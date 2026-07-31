output "resource_ids" {
  description = "Recursos criados — o deployment depende deles para saber quando recriar."
  value = concat(
    [for r in aws_api_gateway_resource.level1 : r.id],
    [for r in aws_api_gateway_resource.level2 : r.id],
  )
}

output "integration_ids" { value = [for i in aws_api_gateway_integration.this : i.id] }
output "route_keys" { value = keys(var.routes) }
