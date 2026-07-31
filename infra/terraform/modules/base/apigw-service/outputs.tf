output "resource_ids" {
  description = "Ids dos recursos criados — o deployment depende deles para saber quando recriar."
  value       = [aws_api_gateway_resource.domain.id, aws_api_gateway_resource.proxy.id]
}

output "integration_ids" {
  value = [aws_api_gateway_integration.domain.id, aws_api_gateway_integration.proxy.id]
}
